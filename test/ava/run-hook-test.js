import test from 'ava'
import {asFunctionArray, runHook} from '../../src/helper'

test('asFunctionArray: null', t => {
  t.deepEqual(asFunctionArray(null), [])
})

test('asFunctionArray: function', t => {
  const func = () => 'foo'
  t.deepEqual(asFunctionArray(func), [func])
})

test('asFunctionArray: functions', t => {
  const funcs = [() => 'foo', () => 'bar']
  t.deepEqual(asFunctionArray(funcs), funcs)
})

test('array', async t => {
  t.is(
    await runHook({
      hook: [({data, context}) => `${data}:${context}`, ({data, context}) => `${data}-${context}`],
      flowKey: 'data',
      data: 'someData',
      context: 'someContext'
    }),
    'someData:someContext-someContext'
  )
})
