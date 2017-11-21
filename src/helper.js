import assert from 'assert'
import debug from 'debug'
import _ from 'lodash'
import mongodb from 'mongodb'
import {getNextSequence, assertNone, getDb, sanitizeKeys} from '@watchmen/mongo-helpr'
import {join, isLike, SEPARATOR, deepClean} from '@watchmen/helpr'
import constants from './constants'
import xformQuery from './xform-query'

const dbg = debug('lib:mongo-data:helper')

const mark = '::'

export async function sequenceIdHook({data, db, opts}) {
  dbg('sequence-id-hook: data=%j, opts=%j', data, opts)
  assert(!data[constants.ID_FIELD], `unexpected ${constants.ID_FIELD} specified`)
  return (await getNextSequence(getName(opts), {db})).toString()
}

export function uniqueSequenceIdHook(field) {
  return async function({data, db, opts}) {
    const id = await sequenceIdHook({data, db, opts})
    const {collectionName} = opts
    // sequence should insure uniqueness, but this can break if the sequences are tampered with,
    // so this sanity check can be used as a second level of insurance
    await assertNone({collectionName, query: {[field]: id}})
    return id
  }
}

export function getMarkedKey(key) {
  assert(key, 'key required')
  return `${key}${mark}`
}

export function markedIdHook(field) {
  return async function({context}) {
    return `${getMarkedKey(context.clientId)}${await uniqueSequenceIdHook(field)(arguments[0])}`
  }
}

export function getName(opts) {
  return opts.name || opts.collectionName
}

export function registerEvent({mode, opts}) {
  const eventName = `${getName(opts)}:${mode}`
  const hook = opts[`${mode}EventHook`]
  if (hook) {
    return function(opts) {
      dbg('calling hook for event=%o', eventName)
      return Promise.all(asFunctionArray(hook).map(elt => elt({...opts, mode})))
    }
    // this is how it might look using node events,
    // but won't handle awaiting all events,
    // so using above version
    //
    // const emitter = new EventEmitter()
    // hooks.map(hook => emitter.on(eventName, hook))
    // return async function (opts) {
    //   emitter.emit(
    //     eventName,
    //     {
    //       ...opts,
    //       mode
    //     }
    //   )
    // }
  }
}

export function mongoIdHook() {
  return new mongodb.ObjectID()
}

export function startsWithMatcher({before, after}) {
  return {
    isMatch: ({key}) => {
      return key.startsWith(`${before}.`) || (!before && key.indexOf('.') < 0)
    },
    xform: ({result, key, value}) => {
      result[join([after, before ? key.slice(before.length + 1) : key])] = value
      return result
    }
  }
}

export function matcherStepsHook(matchers) {
  return async function({steps, query, context, queryPostProcessor}) {
    // this is currently being used to "reverse-engineer" a query that
    // is designed for a _post_ aggregation pipeline into a query that can be applied
    // _pre_ aggregation pipeline. this does not currently work for things involving mongo operators (e.g. $or),
    // so stripping mongo operators so they can't be used to thin the query pre-pipeline,
    // this is generally acceptable in the sense that the pre-pipeline filter is an optimization and
    // the post-pipeline filter will still be applied...
    // should pre-pipeline filtering via mongo operators be required,
    // would need to explore the more complicated approach of "reverse-engineering" mongo operators as well
    //
    const _query = _.transform(await queryPostProcessor({query, context}), (result, val, key) => {
      if (!key.startsWith('$')) {
        result[key] = val
      }
    })
    // dbg('matcher-steps-hook: query=%j, _query=%j', query, _query)
    const $match = await xformQuery(_query, {matchers})
    // dbg('matcher-steps-hook: $match=%j', $match)
    return [{$match}, ...steps]
  }
}

export function startsWithMatcherStepsHook(matchers) {
  const _matchers = matchers.map(matcher => startsWithMatcher(matcher))
  return matcherStepsHook(_matchers)
}

export function isCreate(action) {
  return action && action.trim().toLowerCase() === constants.MODES.create
}

export function isUpdate(action) {
  return action && action.trim().toLowerCase() === constants.MODES.update
}

export function isDelete(action) {
  return action && action.trim().toLowerCase() === constants.MODES.delete
}

export function isUpsert(action) {
  return action && action.trim().toLowerCase() === constants.MODES.upsert
}

export function isUpdateOrUpsert(mode) {
  return isUpdate(mode) || isUpsert(mode)
}

export function isIdField(key) {
  return key === constants.ID_FIELD || key.endsWith(`.${constants.ID_FIELD}`)
}

export function stripPlaceholders(path) {
  return path.replace(/\.\$/g, '')
}

export function getIdPath(path) {
  return join([...stripPlaceholders(path).split('.'), constants.ID_FIELD])
}

// used with mongo aggregation pipeline $concat operator
// https://docs.mongodb.com/manual/reference/operator/aggregation/concat/
//
// args refer to field-names v actual values, mongo will provide values during processing
//
export function getAddressKeyArray({line1, city, state, zip}) {
  return [line1, SEPARATOR, city, SEPARATOR, state, SEPARATOR, zip]
}

export function getAddressKey({street, city, state, zip}) {
  return [street, city, state, zip].join(SEPARATOR)
}

export async function runHook({hook, flowKey, ...rest}) {
  // dbg('run-hook: flow-key=%o, rest=%j', flowKey, rest)
  let _flow = rest[flowKey]
  const _hook = asFunctionArray(hook)

  for (const hook of _hook) {
    const args = {...rest, [flowKey]: _flow}
    // dbg('run-hook: args=%j', args)
    // eslint-disable-next-line no-await-in-loop
    _flow = await hook(args)
    // dbg('run-hook: flow=%j', _flow)
  }
  return _flow
}

export function asFunctionArray(o) {
  if (!o) {
    return []
  }
  if (_.isArray(o)) {
    assert(_.every(o, _.isFunction), `all elements of ${o} must be functions`)
    return o
  }
  if (_.isFunction(o)) {
    return [o]
  }
  throw new Error(`function or array of functions required, received [${o}]`)
}

export function onlyScanned(result) {
  return !(result.modifiedCount || result.upsertedCount)
}

export function getSyntheticResult({result, data, path}) {
  // dbg('get-synthetic-result: path=%o', path)
  // dbg('get-synthetic-result: result=%j', result)
  // dbg('get-synthetic-result: data=%j', data)

  if (result) {
    const value = path ? _.get(result.value, path) : result.value
    // dbg('get-synthetic-result: value=%j', value)
    const _isLike = isLike({actual: value, expected: data})
    // dbg('get-synthetic-result: value=%j, is-like=%o', value, _isLike)
    const {n, upserted} = result.lastErrorObject
    const _result = {
      matchedCount: n,
      upsertedCount: upserted ? 1 : 0,
      modifiedCount: upserted || _isLike ? 0 : 1,
      result: {ok: result.ok, n},
      id: upserted || _.get(value, '_id'),
      original: result.value
    }
    _result.scannedCount = onlyScanned(_result) ? 1 : 0
    _result.data = {...data, _id: _result.id}
    // dbg('get-synthetic-result: result=%j', _result)
    return _result
  }
}

export async function captureDataChange({
  target,
  source,
  user,
  date,
  data,
  update,
  mode = constants.MODES.update
}) {
  // dbg('capture-data-change: args=%j', arguments[0])
  const db = await getDb()
  const result = await db.collection(`${target}History`).updateOne(
    {date},
    {
      $set: deepClean({
        source,
        user,
        mode,
        date,
        data,
        update: sanitizeKeys(update)
      })
    },
    {upsert: true}
  )
  assert(result.result.ok)
  return result
}

export function getContextDate(context) {
  return context.date || new Date()
}

export function getContextUser(context) {
  dbg('get-context-user: context=%o', context)
  return {
    _id: _.get(context, constants.CONTEXT_USER_ID),
    name: _.get(context, constants.CONTEXT_USER_NAME)
  }
}

export async function getChanged({context}) {
  return deepClean({
    date: getContextDate(context),
    user: getContextUser(context)
  })
}
