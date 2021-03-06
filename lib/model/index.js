import Resource from './resource';
import ResourceArray from './resource-array';
import Relationship from './relationship';
import _ from 'lodash';

/*
const user = {
  attributes: {
    name: { type: 'string', match: [ 'valid', 'name' ], },
    age: { type: 'number', min: 18, max: 56, },
    birthday: { type: 'date', },
    is-alive: { type: 'boolean', },
    password: { type: 'hash', max: 56, min: 42, strength: 2, },
  },
  relationships: {
    posts: { type: 'post', isMany: true, model: postModel, },
  },
};
*/

export default class Model {
  constructor(type, schema, adapter, options = {}) {
    if (!type) {
      throw new Error('A model must have a `type` string.')
    }

    if (!schema) {
      throw new Error('A model must have a `schema` object.')
    }


    this.options = options;
    this.type = type;
    this.adapter = adapter;
    this.relationships = schema.relationships || {};
    this.attributes = schema.attributes || {};
  }

  static create() {
    return new Model(...arguments);
  }

  find(query) {
    const options = this.options;

    return new Promise((resolve, reject) => {
      this.adapter.find(this, query)
        .then(data => {
          return resolve(ResourceArray.create(this, data, options));
        })
        .catch(err => {
          return reject(err);
        });
    });
  }

  findResource(id) {
    const options = this.options;

    return new Promise((resolve, reject) => {
      this.adapter.findResource(this, id)
        .then(data => {
          // FIXME: super hacky
          if (options.related) delete options.related;

          if (!data) {
            return reject('Resource not found.');
          }

          return resolve(Resource.create(this, data, options));
        })
        .catch(err => {
          return reject(err);
        });
    });
  }

  findOne(query) {
    const options = this.options;

    return new Promise((resolve, reject) => {
      this.adapter.find(this, query)
        .then(data => {
          // FIXME: super hacky
          if (options.related) delete options.related;

          if (!data) {
            return reject('Resource not found.');
          }

          if (!data[0]) {
            return reject('First resource not found.');
          }

          return resolve(Resource.create(this, data[0], options));
        })
        .catch(err => {
          return reject(err);
        });
    });
  }

  findRelated(id, field, query) {
    const options = this.options;
    const relatedModel = this.relationships[field].model;

    return new Promise((resolve, reject) => {
      this.adapter.findRelated(this, id, field)
        .then(data => {
          options.related = {
            id, relationship: field, type: this.type,
          };

          return _.isArray(data)
            ? resolve(ResourceArray.create(relatedModel, data, options))
            : resolve(Resource.create(relatedModel, data, options));
        })
        .catch(err => {
          return reject(err);
        });
    });
  }

  findRelationship(id, field) {
    return new Promise((resolve, reject) => {
      this.findResource(id)
        .then(resource => {
          return resolve(resource.relationships[field]);
        })
        .catch(err => {
          return reject(err);
        });
    });
  }

  // TODO: remove json api format necessity, and standardize this concept across the lib
  updateRelationship(id, field, body) {
    if (!(body && body.data)) {
      throw new Error('A valid body and data key necessary for updating a relationship');
    }

    const data = body.data;
    const adapter = this.adapter;

    return new Promise((resolve, reject) => {
      this.findRelationship(id, field)
        .then(relationship => {
          const isMany = relationship.isMany;

          // trying to remove to-one relationship
          if (_.isNull(data)) {
            if (isMany) {
              return reject('Cannot update to-many relationship with `null`');
            }

            return resolve(relationship.remove());
          }

          // trying to remove to-many relationship
          if (_.isArray(data)) {
            if (_.isEmpty(data)) {
              if (!isMany) {
                return reject('Cannot update to-one relationship with empty array `[]`');
              }

              return resolve(relationship.removeAll());
            }

            if (!isMany) {
              return reject('Cannot update to-one relationship with array');
            }

            return resolve(relationship.replace(_.map(data, datum => datum.id)));
          }

          this.relationships[field].model.findResource(data.id)
            .then(resource => {
              return resolve(relationship.set(resource));
            })
            .catch(err => {
              return reject(err);
            });
        })
        .catch(err => {
          return reject(err);
        });
    });
  }

  serializeRequest(body) {
    const data = body.data;
    const serialized = {};

    // collect attributes
    _.each(_.keys(data.attributes), attribute => {
      serialized[attribute] = data.attributes[attribute];
    });

    // collect relationships
    _.each(_.keys(data.relationships), relationship => {
      const relationshipData = data.relationships[relationship].data;

      if (_.isEmpty(relationshipData)) {
        return;
      }

      if (_.isArray(relationshipData)) {
        serialized[relationship] = [];
        _.each(relationshipData, relation => {
          serialized[relationship].push(relation.id);
        });
      } else {
        serialized[relationship] = relationshipData.id;
      }
    });

    return serialized;
  }

  createResource(body) {
    const options = this.options;

    if (body.data) {
      body = this.serializeRequest(body);
    }

    // parse fields that are resources or resource arrays
    _.forOwn(body, (value, field) => {
      if (value instanceof Resource) {
        body[field] = value.id;
        return;
      }

      if (value instanceof ResourceArray) {
        body[field] = _.map(value, resource => resource.id);
        return;
      }
    });

    return new Promise((resolve, reject) => {
      this.adapter.createResource(this, body)
        .then(data => {
          return resolve(Resource.create(this, data, options));
        })
        .catch(err => {
          return reject(err);
        });
    });
  }

  updateResource(id, body) {
    if (body.data) {
      body = this.serializeRequest(body);
    }

    return this.adapter.updateResource(this, id, body);
  }

  deleteResource(id) {
    return this.adapter.deleteResource(this, id);
  }

  appendRelationship(id, field, relationships) {
    if (!this.relationships[field].isMany) {
      return Promise.reject(new Error('Cannot append to-one relationships'));
    }

    return new Promise((resolve, reject) => {
      this.findRelationship(id, field)
        .then(relationship => {
          const isMany = relationship.isMany;
          const find = _.map(relationships, relationship => this.relationships[field].model.findResource(relationship));

          Promise.all(find)
            .then(resources => {
              const resourceArray = ResourceArray.create(this.relationships[field].model, null, this.options);
              _.each(resources, resource => resourceArray.resources.push(resource));
              relationship.append(resourceArray);

              return resolve(this.adapter.appendRelationship(this, id, field, relationships));
            })
            .catch(err => {
              return reject(err);
            });
        })
        .catch(err => {
          return reject(err);
        })
    });
  }

  deleteRelationship(id, field, relationships) {
    return this.adapter.deleteRelationship(this, id, field, relationships);
  }

  setRelationship(id, field, relationship) {
    return this.adapter.setRelationship(this, id, field, relationship);
  }

  removeRelationship(id, field) {
    return this.adapter.removeRelationship(this, id, field);
  }

  hasRelationship(type) {
    return !!this.relationships(type);
  }

  hasAttribute(type) {
    return !!this.attributes(type);
  }
}
