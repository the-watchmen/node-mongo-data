import test from 'ava'
import debug from '@watchmen/debug'
import {initFixture} from '@watchmen/mongo-test-helpr'
import {stringify} from '@watchmen/helpr'
import {getDb} from '@watchmen/mongo-helpr'
import getEmbedHooks from '../../src/mongo-embed-helper'

const {createHook, updateHook, deleteHook} = getEmbedHooks({
  contextPath: [
    {key: 'clientId', path: '_id', isGuid: true},
    {key: 'networkId', path: 'networks._id', isGuid: true}
  ]
})

const collectionName = 'clients'

const opts = {
  name: 'networks',
  collectionName
}

const _id = 'c1'

const dbg = debug(__filename)

test('createHook', async t => {
  const db = await getDb()
  await initFixture({db, collectionName, docs: [{_id}]})

  let result = await createHook({
    data: {_id: 'n1', foo: 'bar'},
    db,
    opts,
    context: {clientId: 'c1'}
  })

  result = await db
    .collection(collectionName)
    .find()
    .toArray()

  dbg('result=%s', stringify(result))
  t.is(result[0].networks.length, 1)
})

test('updateHook', async t => {
  const db = await getDb()
  await initFixture({db, collectionName, docs: [{_id, networks: [{_id: 'n1', foo: 'bar'}]}]})

  const networkId = 'n1'
  let result = await updateHook({
    id: networkId,
    data: {foo: 'baz'},
    db,
    opts,
    context: {clientId: 'c1', networkId}
  })

  result = await db
    .collection(collectionName)
    .find()
    .toArray()

  dbg('result=%s', stringify(result))
  t.deepEqual(result[0].networks[0], {_id: networkId, foo: 'baz'})
})

test('deleteHook', async t => {
  const db = await getDb()

  await initFixture({db, collectionName, docs: [{_id, networks: [{_id: 'n1'}]}]})

  let result = await deleteHook({
    id: 'n1',
    db,
    opts,
    context: {clientId: 'c1', networkId: 'n1'}
  })

  result = await db
    .collection(collectionName)
    .find({_id})
    .toArray()
  dbg('result=%s', stringify(result))
  t.deepEqual(result[0], {_id, networks: []})
})

test('updateHook: upsert first', async t => {
  const db = await getDb()

  await initFixture({db, collectionName, docs: [{_id}]})

  const _opts = Object.assign({}, opts, {isUpsert: true})

  const networkId = 'n1'
  let result = await updateHook({
    id: networkId,
    data: {foo: 'bar'},
    db,
    opts: _opts,
    context: {clientId: 'c1', networkId}
  })

  result = await db
    .collection(collectionName)
    .find({_id})
    .toArray()
  dbg('result=%s', stringify(result))
  t.deepEqual(result[0].networks[0], {_id: networkId, foo: 'bar'})
})

test('updateHook: upsert exists', async t => {
  const db = await getDb()

  await initFixture({
    db,
    collectionName,
    docs: [
      {
        _id,
        networks: [{_id: 'n1', foo: 'bar'}]
      }
    ]
  })

  const _opts = Object.assign({}, opts, {isUpsert: true})

  const networkId = 'n1'
  let result = await updateHook({
    id: networkId,
    data: {foo: 'baz'},
    db,
    opts: _opts,
    context: {clientId: 'c1', networkId}
  })

  result = await db
    .collection(collectionName)
    .find({_id})
    .toArray()
  dbg('result=%s', stringify(result))
  t.deepEqual(result[0].networks[0], {_id: networkId, foo: 'baz'})
})

test('updateHook: upsert other exists', async t => {
  const db = await getDb()

  await initFixture({
    db,
    collectionName,
    docs: [
      {
        _id,
        networks: [{_id: 'n1', foo: 'bar'}]
      }
    ]
  })

  const _opts = Object.assign({}, opts, {isUpsert: true})

  const networkId = 'n2'
  let result = await updateHook({
    id: networkId,
    data: {foo: 'baz'},
    db,
    opts: _opts,
    context: {clientId: 'c1', networkId}
  })

  result = await db
    .collection(collectionName)
    .find({_id})
    .toArray()
  dbg('result=%s', stringify(result))
  t.deepEqual(result[0].networks[1], {_id: networkId, foo: 'baz'})
})
