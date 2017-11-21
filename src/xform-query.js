import _ from 'lodash'
import debug from 'debug'
import {parseValue, isListed, stringify} from '@watchmen/helpr'

const dbg = debug('lib:mongo-data:xform-query')

export default async function(query, {blackList, omitKeys = [], xforms = {}, matchers = []} = {}) {
  dbg('args=%o', stringify(arguments))

  //
  // use reduce to create an array suitable for a let/of loop
  // which is "async/await-friendly": http://stackoverflow.com/a/37576787/2371903
  //
  const elements = _.reduce(query, (result, value, key) => [...result, {key, value}], [])

  let result = {}
  /* eslint-disable no-await-in-loop */
  for (const element of elements) {
    dbg('result=%o, element=%o', result, element)
    let {key} = element
    const {value} = element
    if (!omitKeys.includes(key)) {
      const xform = xforms[key]
      if (xform) {
        if (_.isString(xform)) {
          result[xform] = value
          key = xform
        } else if (_.isFunction(xform)) {
          result = await xform({result, key, value})
          continue
        } else {
          throw new TypeError(`unexpected value for xforms[${key}]=${xform}`)
        }
      }
      const parse = !isListed({list: blackList, key, value})
      const matcher = findMatcher({key, value, matchers})
      if (matcher) {
        result = await matcher.xform({result, key, value, parse})
      } else {
        result[key] = parse ? parseValue(value) : value
      }
    }
  }

  dbg('result=%o', stringify(result))
  return result
}

function findMatcher({key, value, matchers}) {
  dbg('is-match: args=%o', stringify(arguments))
  return _.find(matchers, matcher => {
    if (matcher.isMatch({key, value})) {
      dbg('find-matcher: found...')
      return matcher
    }
  })
}
