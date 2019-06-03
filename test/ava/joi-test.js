import test from 'ava'
import joi from 'joi'
import debug from '@watchmen/debug'
import iso6391 from 'iso-639-1'
import {pretty} from '@watchmen/helpr'

const dbg = debug(__filename)

test('joi: basic', t => {
	const schema = joi
		.object()
		.keys({
			username: joi
				.string()
				.alphanum()
				.min(3)
				.max(30)
				.required(),
			password: joi.string().regex(/^[a-zA-Z0-9]{3,30}$/),
			accessToken: [joi.string(), joi.number()],
			birthYear: joi
				.number()
				.integer()
				.min(1900)
				.max(2013),
			email: joi.string().email()
		})
		.with('username', 'birthYear')
		.without('password', 'accessToken')

	let result = joi.validate(
		{
			username: 'abc',
			birthYear: 1994
		},
		schema
	)

	dbg('result=%o', result)
	t.falsy(result.error)

	result = joi.validate(
		{
			username: 'abc',
			birthYear: 'last-year'
		},
		schema
	)

	dbg('result: \n%s', pretty(result))
	t.truthy(result.error)
})

const name = joi.object().keys({
	first: joi.string(),
	last: joi.string()
})

const address = joi.object().keys({
	street: joi.string(),
	city: joi.string(),
	state: joi.string(),
	zip: joi.string()
})

const person = joi.object().keys({
	name,
	address
})

test('joi: nested', t => {
	let result = joi.validate({}, person)

	dbg('result=%o', result)
	t.falsy(result.error)

	const _person = person.requiredKeys('name', 'address')

	result = joi.validate({}, _person)

	dbg('result=%o', result)
	t.truthy(result.error)

	result = joi.validate(
		{
			name: {
				first: 'first-1',
				last: 'last-1'
			},
			address: {
				street: 'street-1',
				city: 'city-1',
				// state: 'state-1',
				zip: 'zip-1'
			}
		},
		_person
	)

	dbg('result: \n%s', pretty(result))
	t.falsy(result.error)
})

test('joi: extend', t => {
	const _joi = joi.extend({
		base: joi.string(),
		name: 'string',
		language: {xxx: 'invalid iso-639-1 code'},
		rules: [
			{
				name: 'xxx',
				validate(params, value, state, options) {
					dbg('validate: params=%o, value=%o, state=%o, options=%o', params, value, state, options)
					return iso6391.validate(value)
						? value
						: this.createError('string.xxx', {v: value}, state, options)
				}
			}
		]
	})

	let result = _joi.validate('en', _joi.string().xxx())
	dbg('result=%o', result)
	t.falsy(result.error)

	result = _joi.validate('xx', _joi.string().xxx())
	dbg('result=%o', result)
	t.truthy(result.error)

	const schema = _joi.object().keys({
		lang: _joi.string().xxx()
	})

	result = _joi.validate({lang: 'ex'}, schema)
	dbg('{lang: en}: result=%o', result)
	t.truthy(result.error)
})
