const _ = require('lodash')
const xml = require('xmlbuilder')

function getFullName(item, separator) {
  if (_.isEmpty(item) || !_.isFunction(item.parent) || !_.isFunction(item.forEachParent)) { return; }

  var chain = [];

  item.forEachParent(function (parent) { chain.unshift(parent.name || parent.id); });

  item.parent() && chain.push(item.name || item.id); // Add the current item only if it is not the collection

  return chain.join(_.isString(separator) ? separator : SEP);
}

/**
 * A function that creates raw XML to be written to Newman JUnit reports.
 *
 * @param {Object} newman - The collection run object, with a event handler setter, used to enable event wise reporting.
 * @param {Object} reporterOptions - A set of JUnit reporter run options.
 * @param {String=} reporterOptions.export - Optional custom path to create the XML report at.
 * @returns {*}
 */
const JunitExtendedReporter = function (newman, reporterOptions) {
  newman.on('beforeDone', function () {
    const report = _.get(newman, 'summary.run.executions')
    const collection = _.get(newman, 'summary.collection')
    let testSuitesExecutionTime = 0
    let executionTime = 0

    if (!report) {
      return
    }

    const classname = _.upperFirst(_.camelCase(collection.name).replace(/\W/g, ''))

    const root = xml.create('testsuites', { version: '1.0', encoding: 'UTF-8' })
    root.att('name', collection.name)
    root.att('tests', _.get(newman, 'summary.run.stats.tests.total', 'unknown'))

    const cache = _.transform(report, function (accumulator, execution) {
      accumulator[execution.item.id] = accumulator[execution.id] || []
      accumulator[execution.item.id].push(execution)
    }, {})

    const timestamp = new Date(_.get(newman, 'summary.run.timings.started')).toISOString()

    _.forEach(cache, function (executions, itemId) {
      const suite = root.ele('testsuite')
      let currentItem
      const tests = {}
      let errors = 0
      let failures = 0
      let errorMessages

      collection.forEachItem(function (item) {
        (item.id === itemId) && (currentItem = item)
      })

      if (!currentItem) { return }

      suite.att('name', getFullName(currentItem))
      suite.att('id', currentItem.id)

      suite.att('timestamp', timestamp)

      _.forEach(executions, function (execution) {
        const iteration = execution.cursor.iteration
        let errored = false
        let msg = `Iteration: ${iteration}\n`

        // Process errors
        if (execution.requestError) {
          ++errors
          errored = true
          msg += ('RequestError: ' + (execution.requestError.stack) + '\n')
        }
        msg += '\n---\n'
        _.forEach(['testScript', 'prerequestScript'], function (prop) {
          _.forEach(execution[prop], function (err) {
            if (err.error) {
              ++errors
              errored = true
              msg = (msg + prop + 'Error: ' + (err.error.stack || err.error.message))
              msg += '\n---\n'
            }
          })
        })

        if (errored) {
          errorMessages = _.isString(errorMessages) ? (errorMessages + msg) : msg
        }

        // Process assertions
        _.forEach(execution.assertions, function (assertion) {
          const name = assertion.assertion
          const err = assertion.error

          if (err) {
            ++failures;
            (_.isArray(tests[name]) ? tests[name].push(err) : (tests[name] = [err]))
          } else {
            tests[name] = []
          }
        })
        if (execution.assertions) {
          suite.att('tests', execution.assertions.length)
        } else {
          suite.att('tests', 0)
        }

        suite.att('failures', failures)
        suite.att('errors', errors)
      })

      suite.att('time', _.mean(_.map(executions, function (execution) {
        executionTime = _.get(execution, 'response.responseTime') / 1000 || 0
        testSuitesExecutionTime += executionTime

        return executionTime
      })).toFixed(3))
      errorMessages && suite.ele('system-err').dat(errorMessages)

      _.forOwn(tests, function (failures, name) {
        const testcase = suite.ele('testcase')

        testcase.att('name', name)
        testcase.att('time', executionTime.toFixed(3))

        // Set the same classname for all the tests
        testcase.att('classname', _.get(testcase.up(), 'attributes.name.value',
          classname))

        if (failures && failures.length) {
          console.log(currentItem);
          const failure = testcase.ele('failure')
          failure.att('type', 'AssertionFailure')
          failure.dat('Failed ' + failures.length + ' times.')
          failure.dat('Collection JSON ID: ' + collection.id + '.')
          failure.dat('Collection name: ' + collection.name + '.')
          failure.dat('Request name: ' + getFullName(currentItem) + '.')
          failure.dat('Test description: ' + name + '.')
          if (failures.length !== 0) {
            failure.att('message', failures[0].message)
            failure.dat('Error message: ' + failures[0].message + '.')
            failure.dat('Stacktrace: ' + failures[0].stack + '.')
          }
        }
      })
    })

    root.att('time', testSuitesExecutionTime.toFixed(3))
    newman.exports.push({
      name: 'junit-reporter',
      default: 'newman-run-report.xml',
      path: reporterOptions.export,
      content: root.end({
        pretty: true,
        indent: '  ',
        newline: '\n',
        allowEmpty: false
      })
    })
  })
}

module.exports = JunitExtendedReporter
