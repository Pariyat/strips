var fs = require('fs');
var PEG = require("pegjs");
var util = require('util');
var combinatorics = require('./js-combinatorics/combinatorics.js').Combinatorics;

/*
AI Planning with STRIPS and PDDL.

Copyright (c) 2018 Kory Becker
http://primaryobjects.com/kory-becker

License MIT
*/

StripsManager = {
    // Set to false to use baseN() instead of permutationCombination() for parameter values. It will be slower, but will utilize all possible solutions. This allows rendering of 'complementary actions', such as 'Action A on A', where normally you want 'Action A on B'.
    fast: true,
    // Set to true to display status information on the console while searching for a solution.
    verbose: false,
    // Set to redirect output to different stream, uses console.log() by default.
    output: function(text) { console.log(text); },
    // PEG.js grammar for domain.
    grammarDomainPath: __dirname + '/grammar/grammar-domain.txt',
    // PEG.js grammer for problem.
    grammarProblemPath: __dirname + '/grammar/grammar-problem.txt',

    loadCode: function(grammarFileName, code, callback) {
        // Applies a PEG.js grammar against a code string and returns the parsed JSON result.
        fs.readFile(grammarFileName, 'utf8', function(err, grammar) {
            if (err) throw err;
         
            var parser = PEG.generate(grammar);
         
            if (callback) {
                callback(parser.parse(code));
            }
        });
    },

    loadGrammar: function(grammarFileName, codeFileName, callback) {
        // Applies a PEG.js grammar against a code file and returns the parsed JSON result.
        fs.readFile(codeFileName, 'utf8', function(err, code) {
            if (err) throw err;

            StripsManager.loadCode(grammarFileName, code, function(result) {
                if (callback) {
                    callback(result);
                }
            });
        });
    },

    loadDomain: function(filePath, callback, isCode) {
        // Applies the PEG.js grammar for a STRIPS PDDL domain file and returns the parsed JSON result.
        if (!isCode) {
            StripsManager.loadGrammar(StripsManager.grammarDomainPath, filePath, function(result) {
                // Load from file path.
                if (callback) {
                    callback(result);
                }
            });
        }
        else {
            // Load from string.
            StripsManager.loadCode(StripsManager.grammarDomainPath, filePath, function(result) {
                if (callback) {
                    callback(result);
                }
            });            
        }
    },

    loadProblem: function(filePath, callback, isCode) {
        // Applies the PEG.js grammar for a STRIPS PDDL problem file and returns the parsed JSON result.
        if (!isCode) {
            // Load from file path.
            StripsManager.loadGrammar(StripsManager.grammarProblemPath, filePath, function(problem) {
                StripsManager.initializeProblem(problem, callback)
            });
        }
        else {
            // Load from string.
            StripsManager.loadCode(StripsManager.grammarProblemPath, filePath, function(problem) {
                StripsManager.initializeProblem(problem, callback)
            });            
        }
    },
    
    initializeProblem: function(problem, callback) {
        // Populate list of parameter values.
        var values = {};
        for (var i in problem.states) {
            var state = problem.states[i];
            for (var j in state.actions) {
                var action = state.actions[j];

                // Collect all unique parameter values.
                for (var k in action.parameters) {
                    values[action.parameters[k]] = 1;
                }
            }
        }

        // Set parameter values list on problem.
        problem.values = {};
        for (var key in values) {
            // Look-up type for this value in the objects declaration.
            var type = null;

            for (var i in problem.objects) {
                for (var j in problem.objects[i].parameters) {
                    var parameter = problem.objects[i].parameters[j];
                    if (parameter == key) {
                        type = problem.objects[i].type;
                        break;
                    }
                }

                if (type)
                    break;
            }

            problem.values[type] = problem.values[type] || [];
            problem.values[type].push(key);
        }

        if (callback) {
            callback(problem);
        }
    },

    load: function(domainPath, problemPath, callback, isCode) {
        // Load the domain and actions. If isCode is true, domainPath and problemPath are strings of PDDL code, otherwise they are filePaths.
        StripsManager.loadDomain(domainPath, function(domain) {
            // Load the problem.
            StripsManager.loadProblem(problemPath, function(problem) {
                // Give a copy of the possible parameter values to the domain.
                domain.values = problem.values;

                if (domain.requirements.indexOf('typing') != -1 && domain.values.null) {
                    StripsManager.output('ERROR: :typing is specified in domain, but not all parameters declare a type. Verify problem file contains an :objects section.');
                }

                // Load list of applicable combinations of parameter values for each action.
                for (var i in domain.actions) {
                    // Get all applicable parameter combinations for the current action.
                    domain.actions[i].parameterCombinations = StripsManager.parameterCombinations(domain, domain.actions[i]);
                }

                if (callback) {
                    callback(domain, problem);
                }
            }, isCode);
        }, isCode);
    },

    predicateCombinations: function(state) {
        // For "Blocks World" problems, combinatorics.permutationCombination(state) is sufficient and faster, but otherwise, baseN(state) gives the full range of possible parameter values.
        // First, convert the values object { block: [ 'a', 'b'], table: ['x', 'y'] } into a flat array [ 'a', 'b', 'x', 'y' ].
        var values = [];
        for (var key in state) {
            for (var i in state[key]) {
                values.push(state[key][i]);
            }
        }

        var cmb = StripsManager.fast ? combinatorics.permutationCombination(values) : combinatorics.baseN(values);

        return cmb.toArray();
    },
    
    parameterCombinations: function(domain, action) {
        // Go through each required parameter, look at the type (if using :typing), and use all combinations of values belonging to that type.
        var cases = [];
        var parameters = action.parameters;

        // Is :typing enabled on the domain?
        if (domain.requirements.indexOf('typing') > -1) {
            // First, get a count of how many parameters we need of each type.
            var error = false;
            var typeCounts = {};
            for (var j in parameters) {
                if (!parameters[j].type) {
                    StripsManager.output('ERROR: :typing is specified, but no type found in action "' + action.action + '" for parameter "' + parameters[j].parameter + '"');
                    error = true;
                    break;
                }

                typeCounts[parameters[j].type] = (typeCounts[parameters[j].type] + 1) || 1;
            }

            if (!error) {
                // Next, get the combination values.
                for (var key in typeCounts) {
                    // Get all combination values for this parameter type.
                    var values = domain.values[key];
                    if (values) {
                        var cmb = combinatorics.baseN(values, 1);

                        cmb.forEach(function(combo) {
                            cases.push(combo);
                        });
                    }
                }
            }

            // Get a combination of all possibilities of the discovered parameters.
            var cmb = StripsManager.fast ? combinatorics.permutation(cases, parameters.length) : combinatorics.baseN(cases, parameters.length);

            // Filter the combinations to valid parameter types and unique combos.
            var uniqueCombos = {};
            cases = cmb.filter(function (combo) {
                // Does this combo have valid values for the type? Make sure each value to be set for a parameter index exists in the list of types under the domain.
                var key = '';

                for (var ci in combo) {
                    var value = combo[ci][0];
                    var type = parameters[ci].type;
                    key += value;

                    // Check if this value exists in the list for this type.
                    if (!domain.values[type] || (domain.values[type] && domain.values[type].indexOf(value) == -1)) {
                        // The value is not part of this type, that means this combo is invalid.
                        return false;
                    }
                }

                if (uniqueCombos[key]) {
                    // Duplicate combo. Since we only take the first value in any lists as 1 value per parameter, we can end up with duplicates.
                    return false;
                }

                uniqueCombos[key] = 1;

                return true;
            });

            var cases2 = [];
            for (var j in cases) {
                var subCase = [];
                for (var k in cases[j]) {
                    subCase.push(cases[j][k][0]);
                }

                cases2.push(subCase);
            }

            cases = cases2;
        }
        else {
            // Typing not being used, just get all action combinations for the current state.
            cases = StripsManager.predicateCombinations(domain.values);
        }

        return cases;
    },

    andCount: function(precondition) {
        // Returns the count for the number of 'and' matches in a precondition.
        var count = 0;
        
        for (var i in precondition) {
            var action = precondition[i];
            var operation = action.operation || 'and'; // If no operation is specified, default to 'and'. Must explicitly provide 'not' where required.
            
            if (operation == 'and') {
                count++;
            }
        }
        
        return count;
    },
    
    isEqual: function(action1, action2) {
        // Returns true if action1 == action2. Compares name and parameters.
        var result = false;

        // Find matching action name.
        if (action1.action == action2.action && action1.parameters.length == action2.parameters.length) {
            result = true;

            // Find matching parameters.
            for (var k in action1.parameters) {
                // Use the map, if available (in the case of a non-concrete action). Otherwise, use the concrete parameter values.
                var value1 = action1.parameters[k].parameter ? action1.parameters[k].parameter : action1.parameters[k];
                var value2 = action2.parameters[k].parameter ? action2.parameters[k].parameter : action2.parameters[k];

                var parameter1 = action1.map ? action1.map[value1] : value1;
                var parameter2 = action2.map ? action2.map[value2] : value2;

                if (parameter1 != parameter2) {
                    result = false;
                    break;
                }
            }
        }
        
        return result;
    },

    isPreconditionSatisfied: function(state, precondition) {
        // Returns true if the precondition is satisfied in the current state.
        // This function works by making sure all 'and' preconditions exist in the state, and that all 'not' preconditions do not exist in the state.
        var matchCount = 0;
        var andCount = StripsManager.andCount(precondition); // The state needs to contain the actions in action.precondition for 'and'. For 'not', we fail immediately. So, let's count the number of 'and' matches and make sure we satisfy them.

        for (var i = 0; i < precondition.length; i++) {
            // Find a case that contains this action and parameters.
            for (var l in state.actions) {
                var match = true;
                operation = precondition[i].operation || 'and'; // If no operation is specified, default to 'and'. Must explicitly provide 'not' where required.

                // Check if the name and number of parameters match for the current action and precondition.
                if (state.actions[l].action == precondition[i].action && state.actions[l].parameters.length == precondition[i].parameters.length) {
                    // Check if the parameter values match.
                    for (var m in precondition[i].parameters) {
                        if (precondition[i].parameters[m] != state.actions[l].parameters[m]) {
                            match = false;
                        }
                    }
                }
                else {
                    match = false;
                }

                if (match) {
                    // This action exists in the state.                    
                    if (operation == 'and') {
                        matchCount++;
                    }
                    else {
                        // Not, set to -1 so this action is not saved as applicable.
                        matchCount = -1;
                        break;
                    }
                }
            }
            
            if (matchCount == -1)
                break;
        }
        
        return (matchCount == andCount);
    },

    getApplicableActionInState: function(state, action) {
        // This function returns an applicable concrete action for the given state, or null if the precondition is not satisfied.
        var resolvedAction = null;

        // Does the filled-in precondition exist in the state test cases?
        if (StripsManager.isPreconditionSatisfied(state, action.precondition)) {
            // This action is applicable.
            // Assign a value to each parameter of the effect.
            var populatedEffect = JSON.parse(JSON.stringify(action.effect));
            for (var m in action.effect) {
                var effect = action.effect[m];

                for (var n in effect.parameters) {
                    var parameter = effect.parameters[n];
                    var value = action.map[parameter];
                    
                    if (value) {
                        // Assign this value to all instances of this parameter in the effect.
                        populatedEffect[m].parameters[n] = value;
                    }
                    else {
                        StripsManager.output('* ERROR: Value not found for parameter ' + parameter + '.');
                    }
                }
            }
            
            resolvedAction = JSON.parse(JSON.stringify(action));
            resolvedAction.effect = populatedEffect;
            resolvedAction.map = action.map;
        }
        
        return resolvedAction;
    },
    
    applicableActionsPlus: function(domain, state) {
        // Returns an array of applicable concrete actions for the current state, including support for negative literals. This method runs StripsManager.applicableActions() two times - one with all positive literals (negative literals removed, which effectively renders all positive literal cases), and one with all positive literals with none that had matching negative literals (which effectively renders all negative literal cases). The result includes a list of unique actions.
        var result = [];
        var actionHash = {};

        // Remove negative literals.
        var stateNoNegatives = JSON.parse(JSON.stringify(state));
        stateNoNegatives.actions = [];
        for (var i in state.actions) {
            var action = state.actions[i];

            if (action.operation != 'not') {
                // Not a negative literal, so keep it.
                stateNoNegatives.actions.push(action);
            }
        }

        // Get applicable actions.
        var actions = StripsManager.applicableActions(domain, stateNoNegatives);

        // Mark each action as discovered.
        for (var i in actions) {
            var action = actions[i];

            result.push(action);
            actionHash[JSON.stringify(action)] = 1;
        }

        // Remove matching positive and negative literals, effectively rendering the negative literal.
        var literalsToRemove = {};
        var stateNoPositiveNegatives = JSON.parse(JSON.stringify(state));
        stateNoPositiveNegatives.actions = [];

        // First, collect negative literals.
        for (var i in state.actions) {
            var action = state.actions[i];
            action.operation = action.operation || 'and';

            if (action.operation == 'not') {
                // Make a copy of the positive version of this literal.
                var copyAction = JSON.parse(JSON.stringify(action));
                copyAction.operation = 'and';

                // Mark the positive version of this literal to be removed (if we come across it).
                literalsToRemove[JSON.stringify(copyAction)] = 1;
            }
        }

        // Now that we've marked negative literals, go through all literals and only keep those which are positive and not included in the literalsToRemove.
        for (var i in state.actions) {
            var action = state.actions[i];
            action.operation = action.operation || 'and';

            // If this is a positive literal and not in our literalsToRemove list, then include it.
            if (action.operation != 'not' && !literalsToRemove[JSON.stringify(action)]) {
                // Safe to keep this literal.
                stateNoPositiveNegatives.actions.push(action);
            }
        }

        // Get applicable actions when allowing for negative literals.
        actions = StripsManager.applicableActions(domain, stateNoPositiveNegatives);

        // Concat new actions.
        for (var i in actions) {
            var action = actions[i];

            if (!actionHash[JSON.stringify(action)]) {
              result.push(action);
            }
        }

        return result;
    },

    applicableActions: function(domain, state) {
        // Returns an array of applicable concrete actions for the current state, using the possible parameter values in domain.values array (Example: values = ['a', 'b', 't1', 't2', 't3']).
        // Test each domain action precondition against the cases. If one holds valid, then that action is applicable in the current state.
        var result = [];

        if (!domain.values || domain.values.length == 0) {
            StripsManager.output('ERROR: No parameter values found in domain.values.');
            return;
        }

        for (var i in domain.actions) {
            var action = domain.actions[i]; // op1
            var parameters = action.parameters; // x1, x2, x3
            var populatedAction = JSON.parse(JSON.stringify(action)); // copy for replacing parameters with actual values.
            var parameterMapHash = {};

            // Assign values to the parameters for each test case.
            for (var j in action.parameterCombinations) {
                var testCase = action.parameterCombinations[j];
                var nindex = 0;
                
                var parameterMap = []; // map of parameter values to be populated
                // Initialize default parameter values for this action. We'll set concrete values next.
                for (var j in parameters) {
                    parameterMap[parameters[j].parameter] = testCase[nindex++];
                }

                // Get the action's precondition parameters.
                var testCaseIndex = 0;
                for (var k in action.precondition) {
                    var precondition = action.precondition[k];
                    var populatedPreconditionPart = JSON.parse(JSON.stringify(precondition)); // copy for replacing parameters with actual values.
                    
                    // Found a matching action. So far, so good.
                    var parameterIndex = 0;
                    
                    // Assign a value to each parameter of the precondition.
                    for (var l in precondition.parameters) {
                        var parameter = precondition.parameters[l];
                        var value = parameterMap[parameter];

                        // Assign this value to all instances of this parameter in the precondition.
                        populatedPreconditionPart.parameters[l] = value;
                    }
                    
                    populatedAction.precondition[k] = populatedPreconditionPart;
                    populatedAction.map = parameterMap;
                }

                // Does the filled-in precondition exist in the test cases?
                var applicableAction = StripsManager.getApplicableActionInState(state, populatedAction);
                if (applicableAction) {
                    // This action is applicable in this state. Make sure we haven't already found this one.
                    var isDuplicate = false;
                    for (var rr in result) {
                        var action1 = result[rr];
                        if (StripsManager.isEqual(applicableAction, action1)) {
                            isDuplicate = true;
                            break;
                        }
                    }

                    if (!isDuplicate) {
                        result.push(applicableAction);
                    }
                }
            }
        }

        return result;
    },

    applyAction: function(action, state) {
        // Applies an action on a state and returns the new state. It is assumed that the precondition has already been tested.
        var result = JSON.parse(JSON.stringify(state));

        for (var i in action.effect) {
            var actionOperation = action.effect[i];
            var operation = actionOperation.operation || 'and';
            
            if (operation == 'and') {
                // Make sure this predicate doesn't already exist in the state.
                var isExists = false;
                for (var j in state.actions) {
                    // Find matching action.
                    if (StripsManager.isEqual(state.actions[j], actionOperation)) {
                        isExists = true;
                        break;
                    }
                }

                if (!isExists) {
                    // Add this predicate to the state.
                    result.actions.push(actionOperation);
                }                
            }
            else {
                // Remove this predicate from the state.
                for (var j in state.actions) {
                    // Find matching action.
                    if (StripsManager.isEqual(state.actions[j], actionOperation)) {
                        // This is our target. Find the same item in our result list (since result may now have different indices than state.actions, if new actions were added via 'and').
                        for (var k in result.actions) {
                            if (StripsManager.isEqual(state.actions[j], result.actions[k])) {
                                result.actions.splice(k, 1);
                            }
                        }
                    }
                }
            }
        }

        return result;
    },

    getChildStates: function(domain, state) {
        // Returns the list of child states for the current state, after applying all applicable actions.
        var children = [];

        var actions = StripsManager.applicableActions(domain, state);
        for (var i in actions) {
            var action = actions[i];
            children.push({ state: StripsManager.applyAction(action, state), action: action });
        }

        return children;
    },

    isGoal: function(state, goalState) {
        // Returns true if the state contains the goal conditions.
        var result = true;

        for (var i in goalState.actions) {
            var goalAction = goalState.actions[i];
            var operation = goalAction.operation || 'and';

            if (operation == 'and') {
                // Make sure this action exists in the state.
                var isExists = false;
                for (var j in state.actions) {
                    if (StripsManager.isEqual(state.actions[j], goalAction)) {
                        isExists = true;
                        break;
                    }
                }

                // If we found a match, then this goal action exists. Move on to next tests.
                if (!isExists) {
                    result = false;
                    break;
                }
            }
            else {
                // Make sure this action does not exist in the state.
                var isExists = false;
                for (var j in state.actions) {
                    if (StripsManager.isEqual(state.actions[j], goalAction)) {
                        // This is our target, so it fails the goal test.
                        isExists = true;
                        break;
                    }
                }

                if (isExists) {
                    // Found a match for 'not', so goal fails.
                    result = false;
                    break;
                }
            }
        }

        return result;
    },

    actionToString: function(action) {
        var result = action.action;

        for (var key in action.map) {
            result += ' ' + action.map[key];
        }

        return result;
    },

    stateToString: function(state) {
        var result = '';
        var actionList = [];

        for (var i in state.actions) {
            var action = state.actions[i];

            var actionString = '(' + action.action;
            for (var j in action.parameters) {
                actionString += ' ' + action.parameters[j];
            }
            actionString += ')';

            // Keep a list of actions so we can sort them. This allows two states with different orderings of the same actions to result in the same string.
            actionList.push(actionString);
        }

        for (var i in actionList.sort()) {
            if (i > 0) {
                result += ' ';
            }
            result += actionList[i];
        }

        return result;
    },

    solve: function(domain, problem, isDfs, maxSolutions, cost) {
        // Find solution using A*, depth-first, or breadth-first search.
        if (typeof(isDfs) == 'function' && !cost) {
            // Allow passing cost as 3rd parameter.
            cost = isDfs;
        }
        else if (isDfs == null) {
            // If no other option specified, use depth-first-search by default.
            isDfs = true;
        }
        
        maxSolutions = maxSolutions || 1;

        if (cost && typeof(cost) != 'function') {
            StripsManager.output('ERROR: parameter "cost" must be a function to serve as the A* algorithm heuristic. Method: solve(domain, problem, isDepthFirstSearch, cost, maxSolutions). Usage: solve(domain, problem), solve(domain, problem, false), solve(domain, problem, cost).');
            return;
        }
        
        if (StripsManager.verbose) {
            StripsManager.output('Using ' + (cost ? 'A*' : (isDfs ? 'depth' : 'breadth') + '-first-search') + '.');
            StripsManager.output('');
        }

        return cost ? StripsManager.solveAs(domain, problem.states[0], problem.states[1], cost) :
                      (isDfs ? StripsManager.solveDfs(domain, problem.states[0], problem.states[1], maxSolutions) :
                               StripsManager.solveBfs(domain, problem.states[0], problem.states[1], maxSolutions));
    },

    solveDfs: function(domain, state, goalState, maxSolutions, visited, depth) {
        // Find all solutions using depth-first-search.
        var solutions = [];

        visited = visited ? JSON.parse(JSON.stringify(visited)) : {};
        depth = depth || 0;
        state = state.state ? state : { state: state }; // format state to mirror child, which includes parent and action in recursion.

        // If this is the initial state, add it to the visited list.
        if (Object.keys(visited).length == 0) {
            visited[StripsManager.stateToString(state.state)] = 1;
        }

        // Check for goal.
        if (StripsManager.isGoal(state.state, goalState)) {
            // Compile solution path.
            var path = [];
            var steps = depth;

            while (state != null && state.parent != null) {
                // Since we move from goal backwards, add this step to the front of the array (rather than the end, otherwise it would be in reverse order).
                path.unshift(StripsManager.actionToString(state.action));
                state = state.parent;
            }

            return [ { steps: steps, path: path } ];
        }
        else {
            // Get child states by applying actions to current state.
            var fringe = StripsManager.getChildStates(domain, state.state);

            if (StripsManager.verbose) {
                StripsManager.output('Depth: ' + depth + ', ' + fringe.length + ' child states.');
            }
            
            // Run against each new child state.
            for (var i in fringe) {
                var child = fringe[i];
                child.parent = state;
                var key = StripsManager.stateToString(child.state);

                if (!visited[key]) {
                    visited[key] = 1;
                    var subSolutions = StripsManager.solveDfs(domain, child, goalState, maxSolutions, visited, depth + 1);
                    if (subSolutions.length > 0) {
                        // This branch has a solution(s).
                        for (var j in subSolutions) {
                            solutions.push(subSolutions[j]);

                            if (solutions.length >= maxSolutions) {
                                break;
                            }
                        }

                        if (solutions.length >= maxSolutions) {
                            break;
                        }
                    }
                }
            }
        }

        return solutions;
    },

    solveBfs: function(domain, state, goalState, maxSolutions) {
        // Find all solutions using breadth-first-search.
        var fringe = [ { state: state, depth: 0 } ]; // Start with the initial state on the fringe.
        var visited = {};
        var depth = 0;
        var solutions = [];

        while (fringe.length > 0) {
            // Investigate the next state with the lowest depth.
            var current = fringe[0];

            // Remove this state from the fringe.
            fringe.shift();

            // Mark this state as visited.
            visited[StripsManager.stateToString(current.state)] = 1;

            // Check for goal.
            if (StripsManager.isGoal(current.state, goalState)) {
                // Compile solution path.
                var path = [];
                var steps = current.depth;

                while (current != null && current.parent != null) {
                    // Since we move from goal backwards, add this step to the front of the array (rather than the end, otherwise it would be in reverse order).
                    path.unshift(StripsManager.actionToString(current.action));
                    current = current.parent;
                }

                solutions.push({ steps: steps, path: path });

                if (solutions.length >= maxSolutions) {
                    return solutions;
                }
            }
            else {
                // Get child states by applying actions to current state.
                var children = StripsManager.getChildStates(domain, current.state);

                // Add the children to the fringe.
                for (var i in children) {
                    var child = children[i];
                    child.parent = current;
                    child.depth = current.depth + 1;

                    if (!visited[StripsManager.stateToString(child.state)]) {
                        fringe.push(child);
                    }
                }
            }

            if (StripsManager.verbose) {
                StripsManager.output('Depth: ' + current.depth + ', ' + fringe.length + ' child states.');
            }
        }

        return solutions;
    },
    
    solveAs:function(domain, state, goalState, cost) {
        // Find first solution using A* search, where cost is the heuristic function (h = cost(state)). Starting with the initial state, we find all children by applying applicable actions on the current state, calculate the child state costs, and select the next cheapest state to visit.
        var depth = 0;
        var fringe = [ { state: state, h: cost(state), g: depth } ]; // Start with the initial state on the fringe.
        var visited = {};
        var solutions = [];

        while (fringe.length > 0) {
            // Investigate the next state with the lowest cost.
            var current = fringe[0];

            // Remove this state from the fringe.
            fringe.shift();

            // Mark this state as visited.
            visited[StripsManager.stateToString(current.state)] = 1;

            // Check for goal.
            if (StripsManager.isGoal(current.state, goalState)) {
                // Compile solution path.
                var path = [];
                var steps = current.g;

                while (current != null && current.parent != null) {
                    // Since we move from goal backwards, add this step to the front of the array (rather than the end, otherwise it would be in reverse order).
                    path.unshift(StripsManager.actionToString(current.action));
                    current = current.parent;
                }

                solutions.push({ steps: steps, path: path });

                return solutions;
            }
            else {
                // Get child states by applying actions to current state.
                var children = StripsManager.getChildStates(domain, current.state);

                // Add the children to the fringe.
                for (var i in children) {
                    var child = children[i];
                    child.parent = current;
                    child.g = current.g + 1;
                    child.h = cost(child.state);
                    
                    if (!visited[StripsManager.stateToString(child.state)]) {
                        fringe.push(child);
                    }
                }
                
                fringe.sort(function(a, b) { return (a.h + a.g) - (b.h + b.g) });
            }

            if (StripsManager.verbose) {
                StripsManager.output('Depth: ' + current.g + ', Current cost: ' + (current.h + current.g) + ', ' + fringe.length + ' child states.');
            }
        }

        return solutions;
    },

    solveGraph:function(domain, problem) {
        var graph = [];
        var layer = [];
        var isDone = false;
        var min = 1;
        var max = 1;

        // Load goal states that we need to find.
        var goalLiterals = {};
        for (var i in problem.states[1].actions) {
            var action = problem.states[1].actions[i];
            action.operation = action.operation || 'and';

            goalLiterals[JSON.stringify(action)] = 0;
        }

        while (!isDone) {
            // Reset goal literals.
            for (var i in goalLiterals) {
                goalLiterals[i] = 0;
            }

            // Step 1: Check if all goal literals appear in the last layer's effects.
            var isGoalPresent = false;
            while (!isGoalPresent) {
                // Get graph.
                graph = StripsManager.graph(domain, problem, min++, max++);

                // Check last graph layer.
                layer = graph[graph.length - 1];
                for (var i in layer) {
                    var action = layer[i];

                    // Get literals in layer.
                    for (var j in action.effect) {
                        var literal1 = action.effect[j];

                        // Compare literals in layer to those in goal state.
                        for (var k in problem.states[1].actions) {
                            var literal2 = problem.states[1].actions[k];
                            literal2.operation = literal2.operation || 'and';

                            if (literal1.action == literal2.action && literal1.operation == literal2.operation && JSON.stringify(literal1.parameters) == JSON.stringify(literal2.parameters)) {
                                // Found a goal literal.
                                var obj = JSON.parse(JSON.stringify(literal1));
                                delete obj.mutex;

                                goalLiterals[JSON.stringify(obj)] = goalLiterals[JSON.stringify(obj)] || [];
                                goalLiterals[JSON.stringify(obj)].push(action);
                            }
                        }
                    }
                }

                isGoalPresent = true;

                // Check if all goal states are available.
                for (var goal in goalLiterals) {
                    if (!goalLiterals[goal]) {
                        isGoalPresent = false;
                    }
                }

                if (isGoalPresent) {
                    // Check if all goal states are not mutex.
                    for (var goal1 in goalLiterals) {
                        var literal1 = JSON.parse(goal1);

                        // Check if the goal literal is mutex with any of the other goal literals.
                        for (var goal2 in goalLiterals) {
                            var literal2 = JSON.parse(goal2);

                            if (goal1 != goal2) {
                                if (StripsManager.isActionMutex(literal1, literal2)) {
                                    isGoalPresent = false;
                                    break;
                                }
                            }
                        }

                        if (!isGoalPresent) break;
                    }
                }
            }

            if (isGoalPresent) {
                // Try to find a solution with GraphSearch.
                //if (StripsManager.verbose) {
                    console.log('Found goal literals at layer ' + graph.length);
                //}

                StripsManager.solveGraphInner(graph, graph.length - 1, goalLiterals);
            }
        }
    },

    solveGraphInner: function(graph, layerIndex, goalLiterals, solution) {
        var values = [];
        var layer = graph[layerIndex];

        // For each goal literal, find a parent action that is not mutex with any other goal literal parent action.
        for (var effect in goalLiterals) {
            var actions = goalLiterals[effect]; // parent actions of this effect

            // Setup values to get a combination of all possible parent actions from each literal.
            for (var i in actions) {
                var action = actions[i];

                // Parent action for this effect.
                values.push({ action: action, literal: effect });
            }
        }

        // Get a combination of all possible parent actions from all other actions from other effects).
        var cmb = combinatorics.combination(values, Object.keys(goalLiterals).length).filter(function (combo) {
            // Combination will pick 3 actions from the list. We need to filter out valid combinations to include those where each literal is represented.
            var literalHash = {};

            for (var i in combo) {
                literalHash[JSON.stringify(combo[i].literal)] = combo[i];
            }

            // If we have the same number of unique literals in our hash as in goalLiterals, then this is a valid combination of actions.
            return (Object.keys(literalHash).length == Object.keys(goalLiterals).length);
        });

        var count1 = 0;
        var count2 = 0;

        // We now have valid combinations of actions to try. Let's find one without mutexes with other actions.
        for (var i in cmb) {
            // Get a combination of actions case.
            var actions = cmb[i];
            var isValid = true;

            // Check each action in this combination and make sure none are mutex with each other.
            for (var j in actions) {
                var action1 = actions[j].action;

                for (var k in actions) {
                    var action2 = actions[k].action;

                    if (action1 != action2) {
                        if (StripsManager.isActionMutex(action1, action2)) {
                            // Found a mutex, so this case fails.
                            isValid = false;
                            break;
                        }
                    }
                }

                if (!isValid) break;
            }

            if (isValid) {
                count1++;

                // Each action in actions is valid. Next, get the parent literals (preconditions) for these actions and verify not mutex.
                for (var j in actions) {
                    var action1 = actions[j].action;
//console.log('Action: ');
//console.log(action1);
                    for (var k in action1.precondition) {
                        // Not sure why we need this, but it's currently needed or undefined error.
                        if (k == 'mutex') continue;

                        var precondition1 = action1.precondition[k];
                        var preconditionAction1 = null;

                        // Lookup action that matches precondition, so we have the mutexes.
                        for (var ii in layer) {
                            var testAction = layer[ii];

                            if ((testAction.action == precondition1.action && testAction.precondition[0].operation == precondition1.operation && JSON.stringify(testAction.parameters) == JSON.stringify(precondition1.parameters)) ||
                                (testAction.type == 'noop' && testAction.action == precondition1.action && testAction.precondition[0].operation == precondition1.operation && JSON.stringify(testAction.precondition[0].parameters) == JSON.stringify(precondition1.parameters))) {
                                preconditionAction1 = testAction;
                                break;
                            }
                        }

                        if (!preconditionAction1) {
                            // Action not in this graph layer, must be an effect.
                            console.log('ERROR - Action not found for precondition 1:' + layerIndex);
                        /*    console.log('precondition1');
                            console.log(precondition1);
                        for (var ii in layer) {
                            var testAction = layer[ii];
                            console.log('testAction');
                            console.log(testAction);
                        }                            exit;*/
                            break;
                        }
//console.log('----------------------');
                        for (var l in actions) {
                            var action2 = actions[l].action;

                            if (action1 != action2) {
                                for (var m in action2.precondition) {
                                    // Not sure why we need this, but it's currently needed or undefined error.
                                    if (m == 'mutex') continue;

                                    var precondition2 = action2.precondition[m];
                                    var preconditionAction2 = null;

                                    // Lookup action that matches precondition, so we have the mutexes.
                                    for (var ii in layer) {
                                        var testAction = layer[ii];
                                        testAction.operation = testAction.operation || 'and';
                                        precondition2.operation = precondition2.operation || 'and';

                                        if ((testAction.action == precondition2.action && testAction.precondition[0].operation == precondition2.operation && JSON.stringify(testAction.parameters) == JSON.stringify(precondition2.parameters)) ||
                                            (testAction.type == 'noop' && testAction.action == precondition2.action && testAction.precondition[0].operation == precondition2.operation && JSON.stringify(testAction.precondition[0].parameters) == JSON.stringify(precondition2.parameters))) {
                                            preconditionAction2 = testAction;
                                            break;
                                        }
                                    }

                                    if (!preconditionAction2) {
                                        console.log('ERROR - Action not found for precondition 2:');
                                        console.log(precondition2);
                                        break;
                                    }

                                    // Check for mutex between precondition1's and precondition2's literals.
                                    if (StripsManager.isActionMutex(preconditionAction1, preconditionAction2)) {
                                        // Literals are mutex, we fail.
                                        isValid = false;
                                        break;
                                    }
                                }
                            }

                            if (!isValid) break;
                        }

                        if (!isValid) break;
                    }

                    if (!isValid) break;
                }

                if (isValid) {
                    // Literals are not mutex. Now get parent actions.
                    // Set new goal states that we need to find (literals).
        //console.log('goalLiterals1:');
//console.log(goalLiterals);

                    goalLiterals = {};
                    var goalActions = [];

                    for (var i in actions) {
                        var action = actions[i].action;

                        if (action.type != 'noop') {
                            solution = solution || [];
                            solution.unshift(action);
                        }

                        for (var j in action.precondition) {
                            var precondition = action.precondition[j];
                            if (precondition) {
                                // This is a goal literal.
                                goalActions.push(precondition);

                                var key = JSON.stringify({ operation: precondition.operation, action: precondition.action, parameters: precondition.parameters });
                                if (key.length > 5 && precondition.action)
                                    goalLiterals[key] = 0;
                            }
                        }
                        /*action.operation = action.precondition[0].operation;
                        action.parameters = action.precondition[0].parameters;

                        goalActions.push(action);
                        goalLiterals[JSON.stringify({ operation: action.operation, action: action.action, parameters: action.parameters })] = 0;*/
                    }
        //console.log('goalLiterals1b:');
//console.log(goalLiterals);

                    if (layerIndex - 1 >= 0) {
                        var layerp = graph[layerIndex - 1];

                        // Find new goal actions.
                        for (var i in layerp) {
                            var action = layerp[i];

                            // Get literals in layer.
                            for (var j in action.effect) {
                                var literal1 = action.effect[j];

                                // Compare literals in layer to those in goal state.
                                for (var k in goalActions) {
                                    var literal2 = goalActions[k];
                                    literal2.operation = literal2.operation || 'and';

                                    if (literal1.action == literal2.action && literal1.operation == literal2.operation && JSON.stringify(literal1.parameters) == JSON.stringify(literal2.parameters)) {
                                        // Found a goal literal.
                                        var obj = JSON.parse(JSON.stringify(literal1));
                                        delete obj.mutex;

                                        goalLiterals[JSON.stringify(obj)] = goalLiterals[JSON.stringify(obj)] || [];
                                        goalLiterals[JSON.stringify(obj)].push(action);                                    
                                    }
                                }
                            }
                        }
        //console.log('goalLiterals2:');
//console.log(goalLiterals);

                        // Move to next layer up.
                        StripsManager.solveGraphInner(graph, layerIndex - 1, goalLiterals, solution);
                    }
                    else {
                        console.log('SOLUTION FOUND!');
                        for (var i in solution) {
                            console.log(StripsManager.actionToString(solution[i]));
                        }
                    }
                }
            }
            else {
                count2++;
            }
        }

        //if (StripsManager.verbose) {
            //console.log(count1 + ' safe actions, ' + count2 + ' mutex actions');
        //}
    },

    nextGraphLayer: function(domain, parentLayer, isSkipNegativeLiterals) {
        // Builds the next planning graph layer, based upon the previous layer. In each action, 'precondition' represents parent literals. 'effect' represents child literals.
        // Returns a 3-tier layer, consisting of P0 (literals), A0 (actions), P1 (literals). The format is: P0 = precondition, A0 = all actions not named 'noop', P1 = effect.
        // If isSkipNegativeLiterals = true, negative literals (mutex) created from an action will be ignored.
        var layer = [];
        var literalHash = {};
        var literalCount = 0;
        var actionCount = 0;

        // Pack all literals from actions in this layer into a single array.
        var children = { effect: [] };
        for (var i in parentLayer) {
            for (var j in parentLayer[i].effect) {
                var literal = JSON.parse(JSON.stringify(parentLayer[i].effect[j]));
                //var literal = parentLayer[i].effect[j];
                literal.operation = literal.operation || 'and';

                if (!isSkipNegativeLiterals || (isSkipNegativeLiterals && literal.operation != 'not')) {
                    if (!literalHash[JSON.stringify(literal)]) {
                        children.effect.push(literal);

                        // P2 - Carry forward literals from parent, using noop actions.
                        var noop = { action: literal.action, type: 'noop' };
                        noop.precondition = noop.precondition || [];
                        noop.precondition.push(literal);
                        noop.effect = noop.precondition;
                        layer.push(noop);

                        literalHash[JSON.stringify(literal)] = 1;
                
                        // Keep a count of all literals in this layer so we know if we found any new ones after graphing.
                        literalCount++;
                    }
                }
            }
        }

        // A1 - Get all applicable actions for the state.
        var actions = StripsManager.applicableActionsPlus(domain, { actions: children.effect });
        actionCount = actions.length;
        for (var i in actions) {
            // Add action to the layer, preconditions are the parents, effects are the children.
            layer.push(actions[i]);
        }

        if (StripsManager.verbose) {
            StripsManager.output('P' + lastGraphIndex + ': ' + lastLiteralCount + ', A' + (lastGraphIndex+1) + ': ' + lastActionCount + ', P' + (lastGraphIndex+1) + ': ' + literalCount + ', A' + (lastGraphIndex+2) + ': ' + actionCount);
        }

        lastGraphIndex++;
        lastLiteralCount = literalCount;

        // If we discovered new literals or new actions, then return the layer and continue building the graph.
        if (lastLiteralCount > literalCount || lastActionCount != actionCount) {
            lastActionCount = actionCount;

            return { layer: layer, done: false };
        }
        else {
            // No change, no new literals.
            return { layer: layer, done: true };
        }
    },

    graph: function(domain, problem, minLayers, maxLayers, isSkipNegativeLiterals, isSkipMutex) {
        // Builds a planning graph for a domain and problem. In each action, 'precondition' represents parent literals. 'effect' represents child literals. Any action not named 'noop' represents an applicable action.
        // Each layer consists of 3-tiers: P0 (literals), A0 (actions), P1 (literals). The format is: P0 = precondition, A0 = actions, P1 = effect.
        // Loops, building new graph layers, until no new literals and no new actions are discovered.
        // If isSkipNegativeLiterals = true, negative literals (mutex) created from an action will be ignored.
        // If isSkipMutex = true, mutex relationships will not be calculated.
        var result = [];
        var layer = [];
        var actionHash = {};

        // P0 - initial literals.
        for (var i in problem.states[0].actions) {
            // P1 - B. Carry forward literals from parent.
            var noop = { action: problem.states[0].actions[i].action, type: 'noop' };
            noop.precondition = noop.precondition || [];
            noop.precondition.push(problem.states[0].actions[i]);
            noop.effect = noop.precondition;
            layer.push(noop);    
        }

        // A0 - Get all applicable actions for the initial state.
        var actions = StripsManager.applicableActionsPlus(domain, problem.states[0]);
        
        // Initialize global graph helper counters.
        lastLiteralCount = layer.length;
        lastActionCount = actions.length;
        lastGraphIndex = 0;

        layer = layer.concat(actions);

        // Add the literals, actions, next literals to the graph (P0, A0, P1).
        result.push(layer);

        // Next layer.
        var index = 0;
        var layer = StripsManager.nextGraphLayer(domain, result[index++], isSkipNegativeLiterals);
        while ((!layer.done || (minLayers && index < minLayers)) && (!maxLayers || index < maxLayers)) {
            if (StripsManager.verbose) {
                StripsManager.output('Processing layer ' + index);
            }

            result.push(layer.layer);

            // Get next graph layer.
            layer = StripsManager.nextGraphLayer(domain, result[index++], isSkipNegativeLiterals);
        }

        // Final ending literals (P1).
        var layerP1 = [];
        for (var i in layer.layer) {
            // P1 - B. Carry forward literals from parent.
            if (layer.layer[i].type === 'noop') {
                layerP1.push(layer.layer[i]);
            }
        }
        result.push(layerP1);

        if (!isSkipMutex) {
            // Mark mutex relationships in the graph.
            result = StripsManager.markMutex(result);
        }

        return result;
    },

    markMutex: function(graph) {
        // Mark all mutexes in the graph.
        var layerIndex = 0;
        graph[layerIndex] = StripsManager.markMutexLayer(graph[layerIndex]);

        while (++layerIndex < graph.length) {
            // Carry forward mutexes from literals on P1 to next layer (which starts on P1).
            for (var i in graph[layerIndex - 1]) { // 7
                for (var ii in graph[layerIndex - 1][i].effect) {
                    var literal1 = graph[layerIndex - 1][i].effect[ii];

                    // Find the P1 noop action that matches this index.
                    for (var j in graph[layerIndex]) { // 12
                        // Ignore 'done' object.
                        if (graph[layerIndex][j].precondition) {
                            if (graph[layerIndex][j].type == 'noop' && graph[layerIndex][j].action == literal1.action && graph[layerIndex][j].precondition[0].operation == literal1.operation && JSON.stringify(graph[layerIndex][j].precondition[0].parameters) == JSON.stringify(literal1.parameters)) {
                                // Found the matching literal. Now copy the mutexs.
                                graph[layerIndex][j].precondition = JSON.parse(JSON.stringify(graph[layerIndex][j].precondition));
                                graph[layerIndex][j].precondition.mutex = literal1.mutex;
                                graph[layerIndex][j].effect = JSON.parse(JSON.stringify(graph[layerIndex][j].effect));
                                
                                // Shouldn't need to do this?
                                if (graph[layerIndex][j].precondition.mutex) {
                                    graph[layerIndex][j].mutex = JSON.parse(JSON.stringify(graph[layerIndex][j].precondition.mutex));
                                }
                            }
                        }
                    }
                }
            }

            graph[layerIndex] = StripsManager.markMutexLayer(graph[layerIndex]);
        }

        return graph;
    },

    markMutexLayer: function(actions) {
        // Mark all mutexes on the given layer.
        // Create a hash entry for each action, for fast lookup.
        var effectHash = {};
        for (var i in actions) {
            var action = actions[i];

            // Ensure precondition and effect are not copies, but separate memory objects.
            //action.precondition = JSON.parse(JSON.stringify(action.precondition));
            action.effect = JSON.parse(JSON.stringify(action.effect));

            for (var j in action.effect) {
                var effect = action.effect[j];

                // Set the effect as the hash key and its parent action as the value.
                effectHash[JSON.stringify(effect)] = effectHash[JSON.stringify(effect)] || [];
                effectHash[JSON.stringify(effect)].push(action);
            }
        }

        // Calculate mutex relationships on the layer.
        actions = StripsManager.markActionsInconsistentEffects(actions, effectHash);
        actions = StripsManager.markActionsInterference(actions, effectHash);
        actions = StripsManager.markLiteralsNegation(actions, effectHash);
        actions = StripsManager.markLiteralsInconsistentSupport(actions, effectHash);

        // Cleanup, remove mutexHash from actions.
        for (var i in actions) {
            for (var j in actions[i].effect) {
                delete actions[i].effect[j].mutexHash;
            }

            delete actions[i].mutexHash;
        }

        return actions;        
    },

    markActionsInconsistentEffects: function(actions, effectHash) {
        // Calculates mutex relationships amongst actions: effect of one action is negation of effect of another.
        // Go through each effect and check if an opposite effect exists. If so, the actions are mutex.
        // Check if an opposite effect exists for each effect.
        for (var i in actions) {
            var action = actions[i];

            if (action.type != 'noop') {
                for (var j in action.effect) {
                    var effect = action.effect[j];
                    
                    // Does an opposite effect exist?
                    var oppositeEffect = JSON.parse(JSON.stringify(effect));
                    oppositeEffect.operation = effect.operation == 'not' ? 'and' : 'not';

                    var mutexAction = effectHash[JSON.stringify(oppositeEffect)];
                    for (var k in mutexAction) {
                        var subMutexAction = mutexAction[k];

                        // Found an opposite. The action at the hash value is a mutex with the current action and vice-versa.
                        action.mutex = action.mutex || [];
                        action.mutexHash = action.mutexHash || {};
                        var obj = { action: subMutexAction.action, precondition: subMutexAction.precondition, effect: subMutexAction.effect, reason: 'inconsistentEffect' };
                        var objStr = JSON.stringify(obj);
                        if (!action.mutexHash[objStr]) {
                            action.mutex.push(obj);
                            action.mutexHash[objStr] = 1;
                        }

                        subMutexAction.mutex = subMutexAction.mutex || [];
                        subMutexAction.mutexHash = subMutexAction.mutexHash || {};
                        obj = { action: action.action, precondition: action.precondition, effect: action.effect, reason: 'inconsistentEffect' };
                        objStr = JSON.stringify(obj);
                        if (!subMutexAction.mutexHash[objStr]) {
                            subMutexAction.mutex.push(obj);
                            subMutexAction.mutexHash[objStr] = 1;
                        }
                    }
                }
            }
        }

        return actions;
    },

    markActionsInterference: function(actions, effectHash) {
        // Calculates mutex relationships amongst actions: one action deletes the precondition of the other.
        // Go through each precondition and check if an opposite effect exists that is not from our own action. If so, the actions are mutex.
        // Now check if an opposite effect exists for each precondition.
        for (var i in actions) {
            var action = actions[i];

            if (action.type != 'noop') {
                for (var j in action.precondition) {
                    var precondition = action.precondition[j];
                    
                    // Does an opposite effect exist?
                    var oppositeEffect = JSON.parse(JSON.stringify(precondition));
                    oppositeEffect.operation = precondition.operation == 'not' ? 'and' : 'not';

                    var mutexAction = effectHash[JSON.stringify(oppositeEffect)];
                    for (var k in mutexAction) {
                        var subMutexAction = mutexAction[k];
                        if (subMutexAction != action) {
                            // Found an opposite (not us). The action at the hash value is a mutex with the current action and vice-versa.
                            action.mutex = action.mutex || [];
                            action.mutexHash = action.mutexHash || {};
                            var obj = { action: subMutexAction.action, precondition: subMutexAction.precondition, effect: subMutexAction.effect, reason: 'interference' };
                            var objStr = JSON.stringify(obj);
                            if (!action.mutexHash[objStr]) {
                                action.mutex.push(obj);
                                action.mutexHash[objStr] = 1;
                            }

                            subMutexAction.mutex = subMutexAction.mutex || [];
                            subMutexAction.mutexHash = subMutexAction.mutexHash || {};
                            obj = { action: action.action, precondition: action.precondition, effect: action.effect, reason: 'interference' };
                            objStr = JSON.stringify(obj);
                            if (!subMutexAction.mutexHash[objStr]) {
                                subMutexAction.mutex.push(obj);
                                subMutexAction.mutexHash[objStr] = 1;
                            }
                        }
                    }
                }
            }
        }

        return actions;        
    },

    markActionsCompetingNeeds: function(actions) {
        // Calculates mutex relationships amongst actions: the actions have preconditions that are mutex at level i-1.
    },

    markLiteralsNegation: function(actions, effectHash) {
        // Calculates mutex relationships amongst literals: if they are negations of one another. For noops, this sets mutexes on the literal precondition and effect (P0, P1) since they are the same. For actions, it sets it just on the effect.
        for (var i in actions) {
            var action = actions[i];

            for (var j in action.effect) {
                var effect = action.effect[j];
                
                // Does an opposite effect exist?
                var oppositeEffect = JSON.parse(JSON.stringify(effect));
                oppositeEffect.operation = effect.operation == 'not' ? 'and' : 'not';

                var mutexAction = effectHash[JSON.stringify(oppositeEffect)];
                for (var k in mutexAction) {
                    var subMutexAction = mutexAction[k];
                    // Found an opposite. The action at the hash value is a mutex with the current action and vice-versa.
                    effect.mutex = effect.mutex || [];
                    effect.mutexHash = effect.mutexHash || {};
                    var obj = { action: oppositeEffect.action, operation: oppositeEffect.operation, parameters: oppositeEffect.parameters, reason: 'negation' };
                    var objStr = JSON.stringify(obj);
                    if (!effect.mutexHash[objStr]) {
                        effect.mutex.push(obj);
                        effect.mutexHash[objStr] = 1;
                    }
                }
            }
        }

        return actions;
    },

    isActionMutex: function(action1, action2) {
        // Check if action2 exists within action1.mutex.
        for (var i in action1.mutex) {
            var action = action1.mutex[i];

            // Clean up before equality test.
            action = JSON.parse(JSON.stringify(action));
            for (var j in action.precondition) {
                delete action.precondition[j].mutex;                            
                delete action.precondition[j].mutexHash;
            }
            for (var j in action.effect) {
                delete action.effect[j].mutex;                            
                delete action.effect[j].mutexHash;
            }

            action2 = JSON.parse(JSON.stringify(action2));
            for (var j in action2.precondition) {
                delete action2.precondition[j].mutex;                            
                delete action2.precondition[j].mutexHash;
            }
            for (var j in action2.effect) {
                delete action2.effect[j].mutex;                            
                delete action2.effect[j].mutexHash;
            }
            delete action2.mutex;
            delete action2.mutexHash;

            if ((action.action == action2.action && JSON.stringify(action.precondition) == JSON.stringify(action2.precondition) && JSON.stringify(action.effect) == JSON.stringify(action2.effect)) ||
                (action.action == action2.action && action.operation == action2.operation && JSON.stringify(action.parameters) == JSON.stringify(action2.parameters)) ||
                (action2.type == 'noop' && action.action == action2.action && action.operation == action2.precondition[0].operation && JSON.stringify(action.parameters) == JSON.stringify(action2.precondition[0].parameters))) {
                return true;
            }
        }

        return false;
    },

    markLiteralsInconsistentSupport: function(actions, effectHash) {
        // Take 2 literals (A, B). Find their parent actions. If each action in A is mutex with every single action in B, then the literals are mutex too.
        for (var i in actions) {
            var action = actions[i];

            // Step 1: Get the first literal.
            for (var j in action.effect) {
                var literal1 = action.effect[j];

                for (var i2 in actions) {
                    if (i2 == i) continue;
                    var action2 = actions[i2];

                    // Step 2: Get the second literal.
                    for (var j2 in action2.effect) {
                        var literal2 = action2.effect[j2];

                        // Step 3: Find the parent actions.
                        var literal1b = JSON.parse(JSON.stringify(literal1));
                        delete literal1b.mutex;
                        delete literal1b.mutexHash;                        
                        var parentActions1 = effectHash[JSON.stringify(literal1b)];
                        var literal2b = JSON.parse(JSON.stringify(literal2));
                        delete literal2b.mutex;
                        delete literal2b.mutexHash;                        
                        var parentActions2 = effectHash[JSON.stringify(literal2b)];

                        // Step 4: Check if each action in A is mutex with every single action in B.
                        var isMutex = true;
                        
                        for (var k in parentActions1) {
                            var parentAction1 = parentActions1[k];

                            for (var l in parentActions2) {
                                var parentAction2 = parentActions2[l];

                                // Test mutex. Must be true for all of parentActions2.
                                if (!StripsManager.isActionMutex(parentAction1, parentAction2)) {
                                    isMutex = false;
                                }
                            }
                        }

                        if (isMutex) {
                            // literal1 is mutex with literal2.
                            literal1.mutex = literal1.mutex || [];
                            literal1.mutexHash = literal1.mutexHash || {};

                            var mutex = { action: literal2.action, operation: literal2.operation, parameters: literal2.parameters, reason: 'inconsistentSupport' };
                            var mutexStr = JSON.stringify(mutex);
                            if (!literal1.mutexHash[mutexStr]) {
                                literal1.mutex.push(mutex);
                                literal1.mutexHash[mutexStr] = 1;
                            }
                        }
                    }
                }
            }
        }

        return actions;
    }
};

module.exports = StripsManager;