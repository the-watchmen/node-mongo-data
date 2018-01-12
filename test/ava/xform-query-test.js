import test from 'ava'
import _ from 'lodash'
import debug from '@watchmen/debug'
import {isFloat} from '@watchmen/helpr'
import {chill} from '@watchmen/test-helpr'
import xformQuery from '../../src/xform-query'

const dbg = debug(__filename)

test('xformQuery: auto', async t => {
  const result = await xformQuery({
    aString: 'foo',
    anInteger: '1',
    aFloat: '1.1',
    aTrueBool: 'true',
    aFalseBool: 'false'
  })
  t.true(_.isString(result.aString))
  t.true(_.isInteger(result.anInteger))
  t.true(isFloat(result.aFloat))
  t.true(result.aTrueBool)
  t.false(result.aFalseBool)
})

test('xform simple', async t => {
  const beforeKey = 'before'
  const afterKey = 'after'
  const val = 'stuff'
  const result = await xformQuery(
    {[beforeKey]: val},
    {
      xforms: {
        [beforeKey]: afterKey
      }
    }
  )
  t.is(result[beforeKey], undefined)
  t.is(result[afterKey], val)
})

test('xform custom async', async t => {
  const beforeKey = 'before'
  const beforeVal = 'foo'
  const afterKey = 'after'
  const afterVal = 'bar'
  const result = await xformQuery(
    {[beforeKey]: beforeVal},
    {
      xforms: {
        [beforeKey]: async ({value}) => {
          t.is(value, beforeVal)
          const actual = await chill({millis: 100, resolution: afterVal})
          t.is(actual, afterVal)
          return {[afterKey]: actual}
        }
      }
    }
  )
  t.is(result[beforeKey], undefined)
  t.is(result[afterKey], afterVal)
})

test('xform with blacklist', async t => {
  const result = await xformQuery(
    {do: '123', dont: '456'},
    {
      blackList: ['dont']
    }
  )
  t.is(result.do, 123)
  t.is(result.dont, '456')
  t.not(result.dont, 456)
})

test('xform with blacklist function', async t => {
  const result = await xformQuery(
    {
      do: '123',
      dont: '456'
    },
    {
      blackList: [
        ({key}) => {
          return ['dont'].includes(key)
        }
      ]
    }
  )

  t.is(result.do, 123)
  t.is(result.dont, '456')
  t.not(result.dont, 456)
})

test('xform matcher', async t => {
  const result = await xformQuery(
    {
      doThis: 'this',
      doThisToo: 'thisToo',
      neverThis: 'never'
    },
    {
      matchers: [
        {
          isMatch: ({key}) => {
            return key.startsWith('do')
          },
          xform: ({result, key, value}) => {
            dbg('match: key=%o', key)
            result[`${key}_`] = `${value}_`
            delete result[key]
            dbg('match: result=%o', result)
            return result
          }
        }
      ]
    }
  )
  t.deepEqual(result, {doThis_: 'this_', doThisToo_: 'thisToo_', neverThis: 'never'})
})
