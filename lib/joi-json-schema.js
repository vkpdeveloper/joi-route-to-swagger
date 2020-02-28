/* eslint no-use-before-define: "off" */
const _ = require('lodash')

function _getFieldType(fieldDefn) {
  let type = fieldDefn.type
  if (type === 'number' && !_.isEmpty(fieldDefn.rules) &&
    fieldDefn.rules[0].name === 'integer') {
    type = 'integer'
  }
  return type
}

function _getFieldDescription(fieldDefn) {
  return _.get(fieldDefn, 'description')
}

function _getFieldExample(fieldDefn) {
  return _.get(fieldDefn, 'examples')
}

function _isRequired(fieldDefn) {
  return _.get(fieldDefn, 'flags.presence') === 'required'
}

function _getDefaultValue(fieldDefn) {
  return _.get(fieldDefn, 'flags.default')
}

function _getEnum(fieldDefn) {
  if (_.isEmpty(fieldDefn.valids)) {
    return undefined
  }

  const enumList = _.filter(fieldDefn.valids, (item) => {
    return !_.isEmpty(item)
  })
  return _.isEmpty(enumList) ? undefined : enumList
}

function _setIfNotEmpty(schema, field, value) {
  if (value !== null && value !== undefined) {
    schema[field] = value
  }
}

function _setBasicProperties(fieldSchema, fieldDefn) {
  _setIfNotEmpty(fieldSchema, 'type', _getFieldType(fieldDefn))
  _setIfNotEmpty(fieldSchema, 'examples', _getFieldExample(fieldDefn))
  _setIfNotEmpty(fieldSchema, 'description', _getFieldDescription(fieldDefn))
  _setIfNotEmpty(fieldSchema, 'default', _getDefaultValue(fieldDefn))
  _setIfNotEmpty(fieldSchema, 'enum', _getEnum(fieldDefn))
}

function _setNumberFieldProperties(fieldSchema, fieldDefn) {
  if (fieldSchema.type !== 'number' && fieldSchema.type !== 'integer') {
    return
  }

  _.each(fieldDefn.rules, (rule) => {
    const value = rule.arg
    switch (rule.name) {
      case 'max':
        fieldSchema.maximum = value
        break
      case 'min':
        fieldSchema.minimum = value
        break
      case 'greater':
        fieldSchema.exclusiveMinimum = true
        fieldSchema.minimum = value
        break
      case 'less':
        fieldSchema.exclusiveMaximum = true
        fieldSchema.maximum = value
        break
      case 'multiple':
        fieldSchema.multipleOf = value
        break
      default:
        break
    }
  })
}

function _setBinaryFieldProperties(fieldSchema, fieldDefn) {
  if (fieldSchema.type !== 'binary') {
    return
  }
  fieldSchema.type = 'string'
  if (fieldDefn.flags && fieldDefn.flags.encoding) {
    fieldSchema.contentEncoding = fieldDefn.flags.encoding
  }
  fieldSchema.format = 'binary'
}

function _setStringFieldProperties(fieldSchema, fieldDefn) {
  if (fieldSchema.type !== 'string') {
    return
  }

  if (fieldDefn.flags && fieldDefn.flags.encoding) {
    fieldSchema.contentEncoding = fieldDefn.flags.encoding
  }
  _.forEach(fieldDefn.meta, (m) => {
    if (m.contentMediaType) {
      fieldSchema.contentMediaType = m.contentMediaType
    }
  })

  _.forEach(fieldDefn.rules, (rule) => {
    switch (rule.name) {
      case 'min':
        fieldSchema.minLength = rule.arg
        break
      case 'max':
        fieldSchema.maxLength = rule.arg
        break
      case 'email':
        fieldSchema.format = 'email'
        break
      case 'hostname':
        fieldSchema.format = 'hostname'
        break
      case 'uri':
        fieldSchema.format = 'uri'
        break
      case 'ip':
        if (!_.isEmpty(rule.arg.version)) {
          if (rule.arg.version.length === 1) {
            fieldSchema.format = rule.arg.version[0]
          } else {
            fieldSchema.oneOf = _.map(rule.arg.version, (version) => {
              return {
                format: version
              }
            })
          }
        } else {
          fieldSchema.format = 'ipv4'
        }
        break
      case 'regex':
        fieldSchema.pattern = rule.arg.pattern.source
        break
      default:
        break
    }
  })
}

function _setArrayFieldProperties(fieldSchema, fieldDefn) {
  if (fieldSchema.type !== 'array') {
    return
  }

  _.each(fieldDefn.rules, (rule) => {
    const value = rule.arg
    switch (rule.name) {
      case 'max':
        fieldSchema.maxItems = value
        break
      case 'min':
        fieldSchema.minItems = value
        break
      case 'length':
        fieldSchema.maxItems = value
        fieldSchema.minItems = value
        break
      case 'unique':
        fieldSchema.uniqueItems = true
        break
      default:
        break
    }
  })

  if (!fieldDefn.items) {
    fieldSchema.items = {}
    return
  }

  if (fieldDefn.items.length === 1) {
    fieldSchema.items = _convertSchema(fieldDefn.items[0])
  } else {
    fieldSchema.items = {
      anyOf: _.map(fieldDefn.items, _convertSchema)
    }
  }
}

function _setDateFieldProperties(fieldSchema, fieldDefn) {
  if (fieldSchema.type !== 'date') {
    return
  }

  if (fieldDefn.flags && fieldDefn.flags.timestamp) {
    fieldSchema.type = 'integer'
  } else {
    // https://datatracker.ietf.org/doc/draft-handrews-json-schema-validation
    // JSON Schema does not have date type, but use string with format.
    // However, joi definition cannot clearly tells the date/time/date-time format
    fieldSchema.type = 'string'
    fieldSchema.format = 'date-time'
  }
}

function _setObjectProperties(schema, joiDescribe) {
  if (schema.type !== 'object') {
    return
  }

  schema.properties = {}
  schema.required = []

  if (joiDescribe.flags && typeof joiDescribe.flags.allowUnknown !== 'undefined') {
    schema.additionalProperties = joiDescribe.flags.allowUnknown
  }

  _.map(joiDescribe.children, (fieldDefn, key) => {
    const fieldSchema = _convertSchema(fieldDefn)
    if (_isRequired(fieldDefn)) {
      schema.required.push(key)
    }

    schema.properties[key] = fieldSchema
  })
  if (_.isEmpty(schema.required)) {
    delete schema.required
  }
}

function _setAlternativesProperties(schema, joiDescribe) {
  if (schema.type !== 'alternatives') {
    return
  }

  schema.oneOf = _.map(joiDescribe.alternatives, _convertSchema)
  delete schema.type
}

function _convertSchema(joiDescribe) {
  const schema = {}

  _setBasicProperties(schema, joiDescribe)
  _setNumberFieldProperties(schema, joiDescribe)
  _setBinaryFieldProperties(schema, joiDescribe)
  _setStringFieldProperties(schema, joiDescribe)
  _setDateFieldProperties(schema, joiDescribe)
  _setArrayFieldProperties(schema, joiDescribe)
  _setObjectProperties(schema, joiDescribe)
  _setAlternativesProperties(schema, joiDescribe)

  return schema
}

class JoiJsonSchemaParser {
  constructor(joiObj) {
    if (typeof joiObj.describe !== 'function') {
      throw new Error('Not an joi object to be described.')
    }
    this.joiVersion = joiObj._currentJoi.version
    this.joiObj = joiObj
    this.joiDescribe = joiObj.describe()
    this.jsonSchema = _convertSchema(this.joiDescribe)
  }
}

module.exports = JoiJsonSchemaParser