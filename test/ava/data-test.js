import test from 'ava'
import {isLike} from '@watchmen/helpr'
import {initDb, initFixture} from '@watchmen/mongo-test-helpr'
import {getDb, findOne} from '@watchmen/mongo-helpr'
import getData from '../../src/data'
import getEmbedHooks from '../../src/mongo-embed-helper'
import {mongoIdHook} from '../../src/helper'

let eventHookFlags = {}
const collectionName = 'test'
const embeddedCollectionName = 'embedded'

const opts = {
	collectionName,
	createEventHook: () => {
		eventHookFlags.create = true
	},
	updateEventHook: () => {
		eventHookFlags.update = true
	}
}

const data = getData(opts)

const {createHook, updateHook} = getEmbedHooks({
	contextPath: [
		{key: 'test._id', path: '_id', isGuid: true},
		{useId: true, path: 'nesters._id', isGuid: true}
	],
	isAssociative: true
})

const embeddedOpts = {
	collectionName,
	name: embeddedCollectionName,
	idHook: mongoIdHook,
	createHook,
	updateHook,
	createEventHook: () => {
		eventHookFlags.create = true
	},
	updateEventHook: () => {
		eventHookFlags.update = true
	}
}

const embeddedData = getData(embeddedOpts)

test.beforeEach(() => {
	eventHookFlags = {}
})

test('create', async t => {
	const db = await getDb()
	await initDb(db)
	let result = await data.create({data: {foo: 'bar'}})
	t.truthy(result.result.ok)
	t.truthy(eventHookFlags.create)
	result = await findOne({collectionName})
	t.truthy(result)
	t.truthy(isLike({actual: result, expected: {foo: 'bar'}}))
})

test('update', async t => {
	const db = await getDb()
	await initFixture({db, collectionName, docs: [{foo: 'bar'}]})
	let result = await data.update({id: {foo: 'bar'}, data: {_id: 'omit', foo: 'baz'}})
	t.truthy(result.result.ok)
	t.truthy(eventHookFlags.update)
	result = await findOne({collectionName})
	t.truthy(result)
	t.truthy(isLike({actual: result, expected: {foo: 'baz'}}))
})

test('meta', async t => {
	const db = await getDb()
	await initFixture({db, collectionName, docs: [{foo: 'bar'}]})
	const result = await data.meta({query: {}, context: {}})
	t.truthy(isLike({actual: result, expected: {count: 1}}))
})

test('update: nested', async t => {
	const db = await getDb()
	await initFixture({db, collectionName, docs: [{foo: {bar: {bim: true, bam: true}}}]})
	const result = await data.update({id: {}, data: {foo: {bar: {bam: false}}}})
	t.truthy(result.result.ok)
	const actual = await findOne({collectionName})
	t.truthy(actual)
	t.truthy(isLike({expected: {foo: {bar: {bim: true, bam: false}}}, actual}))
})

test('upsert: create', async t => {
	const db = await getDb()
	await initDb(db)
	let result = await data.upsert({id: '123', data: {foo: 'baz'}})
	t.truthy(result.result.ok)
	t.truthy(eventHookFlags.create)
	result = await findOne({collectionName, query: {_id: '123'}})
	t.truthy(result)
	t.truthy(isLike({actual: result, expected: {foo: 'baz'}}))
})

test('upsert: update', async t => {
	const db = await getDb()
	await initFixture({db, collectionName, docs: [{foo: 'bar'}]})
	let result = await data.upsert({id: {foo: 'bar'}, data: {foo: 'baz'}})
	t.truthy(result.result.ok)
	t.truthy(eventHookFlags.update)
	result = await findOne({collectionName})
	t.truthy(result)
	t.truthy(isLike({actual: result, expected: {foo: 'baz'}}))
})

// embedded
//

test('create: embedded', async t => {
	const db = await getDb()
	const id = 'id-1'
	await initFixture({db, collectionName, docs: [{_id: id}]})
	let result = await embeddedData.create({context: {'test._id': id}, data: {foo: 'bar'}})
	t.truthy(result.result.ok)
	t.truthy(eventHookFlags.create)
	result = await findOne({collectionName})
	t.truthy(result)
	t.truthy(isLike({actual: result, expected: {nesters: [{foo: 'bar'}]}}))
})

test('update: embedded', async t => {
	const db = await getDb()
	const id = 'id-1'
	const embeddedId = 'embedded-id-1'
	await initFixture({
		db,
		collectionName,
		docs: [{_id: id, nesters: [{_id: embeddedId, foo: 'bar'}]}]
	})
	let result = await embeddedData.update({id: embeddedId, data: {foo: 'baz'}})
	t.truthy(result.result.ok)
	t.truthy(eventHookFlags.update)
	result = await findOne({collectionName})
	t.truthy(result)
	t.truthy(isLike({actual: result, expected: {nesters: [{_id: embeddedId, foo: 'baz'}]}}))
})

test('upsert: embedded: create', async t => {
	const db = await getDb()
	const id = 'id-1'
	const embeddedId = 'nested-id-1'
	await initFixture({db, collectionName, docs: [{_id: id}]})
	let result = await embeddedData.upsert({
		id: embeddedId,
		data: {foo: 'bar'},
		context: {'test._id': id}
	})
	t.truthy(result.result.ok)
	t.truthy(eventHookFlags.create)
	result = await findOne({collectionName})
	t.truthy(result)
	t.truthy(isLike({actual: result, expected: {nesters: [{_id: embeddedId, foo: 'bar'}]}}))
})

test('upsert: embedded: update', async t => {
	const db = await getDb()
	const id = 'id-1'
	const embeddedId = 'embedded-id-1'
	await initFixture({
		db,
		collectionName,
		docs: [{_id: id, nesters: [{_id: embeddedId, foo: 'bar'}]}]
	})
	let result = await embeddedData.upsert({
		id: embeddedId,
		data: {foo: 'baz'},
		context: {'test._id': id}
	})
	t.truthy(result.result.ok)
	t.truthy(eventHookFlags.update)
	result = await findOne({collectionName})
	t.truthy(result)
	t.truthy(isLike({actual: result, expected: {nesters: [{_id: embeddedId, foo: 'baz'}]}}))
})
