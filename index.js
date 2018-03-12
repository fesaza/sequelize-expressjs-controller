'use strict';

import Model from './lappiz.model';
var SQLConnector = require('../sqlConnector');
import logger from '../../config/logger';
import config from '../../config/environment';
import appsettings from '../../config/appsettings';
import rp from 'request-promise';

/**
 * Devuelve la respuesta en JSON a la solicitud
 * @param {Object} res
 * @param {Number} statusCode
 */
function respondWithResult(res, statusCode) {
  statusCode = statusCode || 200;
  return function(entity) {
    if(entity) {
      return res.status(statusCode).json(entity);
    }
    return null;
  };
}

/**
 * Permite manejar los errores ocurridos durante el request
 * @param {Object} res
 * @param {Number} statusCode
 */
function handleError(res, statusCode) {
  statusCode = statusCode || 500;
  return function(err) {
    logger.error(err);
    res.status(statusCode).send(err);
  };
}

/**
 * Permite saber a que entidad esta apuntando la petición Ej: /api/lappiz/personas
 * en ese caso retorna la entidad personas
 * @param {Object} req
 */
function getEntityModel(req) {
  return Model[req.params.entity];
}

/**
 * Permite obtener las relaciones en el modelo acorde al json que llegue al metodo create
 * @param {Object} obj
 * @param {Object} entityModel
 */
function getIncludes(obj, entityModel) {
  var includesProp = new Set();
  for(var key in obj) {
    if(!obj.hasOwnProperty(key)) continue;
    var element = obj[key];
    if(typeof element !== 'object') continue;
    var elementInclude = [];
    logger.info(key);
    if(Array.isArray(element)) {
      logger.info(element.length);
      var _key = key.slice(0, key.length - 1);
      elementInclude = getIncludes(element[0], Model[_key]);
    } else {
      elementInclude = getIncludes(element, Model[key]);
    }
    if(elementInclude) {
      includesProp.add({
        association: entityModel[key],
        include: elementInclude
      });
    } else {
      includesProp.add(entityModel[key]);
    }
  }
  return includesProp.size > 0 ? [...includesProp] : null;
}

/**
 * Permite crear un registro
 * El registro puede tener detalles de tipo lista u objeto
 * También crea los registros que esten en los detalles
 * @param {Object} req
 * @param {Object} res
 */
export function create(req, res) {
  var body = req.body;
  var entityModel = getEntityModel(req);
  var asociations = getIncludes(body, entityModel);
  //Se marca en una transaccion para poder devolver cambios cuando se insertan multiples registros
  return SQLConnector.transaction(function(t) {
    return entityModel.create(body, {include: asociations, transaction: t})
    .then(respondWithResult(res, 201));
  })
  .then(function(/*result*/) {
    // Transaction has been committed
    // result is whatever the result of the promise chain returned to the transaction callback
  })
  .catch(handleError(res));
}

/**
 * Permite procesar los detalles que traiga un objeto al momento de llamar el metodo UnitOfWork
 * @param {Object} obj
 */
function processDetails(obj) {
  var promises = new Set();
  var subPromises;
  for(var key in obj) {
    if(!obj.hasOwnProperty(key)) continue;
    var element = obj[key];
    if(typeof element === 'object') {
      if(Array.isArray(element)) {
        key = key.substring(0, key.length - 1);
        for(var i in element) {
          if(!element.hasOwnProperty(i)) continue;
          var item = element[i];
          promises.add(upsertDetails(item, key));
          subPromises = processDetails(item);
        }
      } else {
        promises.add(upsertDetails(element, key));
        subPromises = processDetails(element);
      }
    }
  }
  if(subPromises) promises = new Set([...promises, ...subPromises]);
  return promises.size > 0 ? [...promises] : null;
}

/**
 * Permite armar un objeto que pueda ser utilizado en el método mappingTransactions
 * @param {Objetc} element
 * @param {String} key
 */
function upsertDetails(element, key) {
  if(element.hasOwnProperty('marked_as_deleted')) {
    if(!element.Id) throw 'Se requiere el campo Id para eliminar el objeto cuando tiene la propiedad marked_as_deleted';
  }

  return {
    delete: element.hasOwnProperty('marked_as_deleted'),
    model: Model[key],
    element
  };
}

/**
 * Permite definir el tipo de operación que requiere un objeto
 * Actalizar, crearlo nuevo, o eliminarlo
 * @param {Object} t
 */
export function mappingTransactions(t) {
  return function(item) {
    if(item.delete) {
      logger.verbose('Eliminando registro');
      return item.model.destroy({
        force: true,
        individualHooks: true,
        where: { Id: item.element.Id },
        transaction: t
      });
    } else if(item.element.Id) {
      //Buscar para actualizar o crear
      return item.model.findById(item.element.Id).then(result => {
        if(result) {
          //Update
          logger.info('Actualizando detalle...');
          return item.model.update(item.element, { where: { Id: item.element.Id }, transaction: t, individualHooks: true});
        } else {
          //Crear
          logger.info('Creando detalle...');
          return item.model.create(item.element, { transaction: t, individualHooks: true});
        }
      });
    } else {
      //Crear
      //logger.info(`Creando detalle...${JSON.stringify(item)}`);
      return item.model.create(item.element, { transaction: t, individualHooks: true});
    }
  };
}

/**
 * Es el metodo que permite procesar las transacciones enviadas desde runtime
 * Se encarga de determinar si debe crear, insertar o eliminar registros
 * Todas las operaciones van enmarcadas dentro de una transaccion,
 * para que pueda devolver los cambios en caso de algún error
 * @param {Object} req
 * @param {Object} res
 */
export function UnitOfWork(req, res) {
  var body = req.body;
  logger.info(body);
  var entityModel = getEntityModel(req);
  return SQLConnector.transaction({autocommit: true}, function(t) {
    var childProcess = processDetails(body);
    if(childProcess) {
      return SQLConnector.Promise.all([
        entityModel.update(
          body,
          { where: { Id: req.params.id }, transaction: t, individualHooks: true}
        ),
        ...childProcess.map(mappingTransactions(t))
      ]);
    } else {
      return entityModel.update(
        body,
        { where: { Id: req.params.id }, transaction: t, individualHooks: true}
      );
    }
  })
  .then(respondWithResult(res, 204))
  .catch(handleError(res));
}

/**
 * Permite eliminar un registro de la base de datos
 * @param {Object} req
 * @param {Object} res
 */
export function destroy(req, res) {
  return getEntityModel(req).destroy({
    force: true,
    individualHooks: true,
    where: {
      Id: req.param('id')
    }
  })
  .then(respondWithResult(res))
  .catch(handleError(res));
}

export function index(req, res) {
  return getEntityModel(req).findAll({})
    .then(function(dptos) {
      return res.status(200).json(dptos);
    })
    .catch(handleError(res));
}

/**
 * Permite ejecutar un procedimiento almacenado
 * @param {Object} req
 * @param {Object} res
 */
export function execsp(req, res) {
  var command = req.body.query;
  logger.verbose(command);
  if(req.body.transaction) {
    return SQLConnector.transaction(function(t) {
      return SQLConnector.query(command, { transaction: t});
    })
    .then(respondWithResult(res, 200))
    .catch(handleError(res));
  } else {
    return SQLConnector.query(command)
      .then(respondWithResult(res))
      .catch(handleError(res));
  }
}

/**
 * Permite registrar o crear un usuario y asignar un rol en caso que este configurado para la app
 * @param {Object} req
 * @param {Object} res
 */
export function registeruser(req, res) {
  return SQLConnector.transaction(function(t) {
    var User = Model.Lappiz_Users;
    var appName = req.body.$$app;
    var pass = req.body.Contrasena;
    //Esta variable se envía solo para el formulario de registro
    var asignrole = req.body.$$addrole;
    req.body.Contrasena = '****';
    req.body.Activo = true;
    delete req.body.$$addrole;
    delete req.body.$$app;
    var include = getIncludes(req.body, User);
    return User.create(req.body, {include, transaction: t})
    .then(handleusercreated(res, appName, pass, asignrole));
  })
  .then(function(/*result*/) {
    // Transaction has been committed
    // result is whatever the result of the promise chain returned to the transaction callback
  })
  .catch(handleError(res));
}

function handleusercreated(res, appName, pass, asignrole) {
  return function(user) {
    if(!appName) throw 'El código de la aplicación es requerido';
    if(!user) throw 'Error inesperado creando el usuario';
    var rolId = appsettings.defaultrole;
    if(!rolId && asignrole) throw 'Solicitud no permitida para esta aplicación, debe habilitar formulario de registro y asignar un rol por defecto en el designer';
    //Replicar usuario en tabla ASPNETUSERS en la bd de configuración
    logger.info('Usuario creado correctamente, replicando...');
    var dataSend = {
      UserName: user.Email,
      Email: user.Email,
      PasswordHash: pass,
      Id: user.Id,
      Activo: user.Activo
    };
    var url = `${config.configapi}/api/Users/replicate?appCode=${appName}`;
    var optionsreplicate = {
      method: 'POST',
      uri: url,
      body: dataSend,
      json: true
    };
    return rp(optionsreplicate).then(function(error, response) {
      if(error || (response && response.statusCode != 200)) {
        console.log(response.statusCode);
        logger.error(error || response);
        throw response || error;
      }
      logger.info('Usuario replicado correctamente...');
      if(!asignrole) return res.status(201).json(user);
      logger.info('Asignando rol...');
        //Asignar el rol que tenga la app por defecto
      var urladdrol = `${config.configapi}/api/Roles/saveChanges?idUser=${user.Id}`;
      var optionsAddRole = {
        method: 'POST',
        uri: urladdrol,
        body: [{
          IdRol: rolId,
          Action: 'Save'
        }],
        json: true
      };
      return rp(optionsAddRole).then(function(error2, response2) {
        if(error2 || (response && response2.statusCode != 200)) {
          throw error2;
        }
        logger.info('Rol asignado correctamente...');
        return res.status(201).json(user);
      })
      .catch(function(err) {
        logger.info(err);
        //Eliminar usuario creado en ASPNETUSERS
        var optsDelete = {
          method: 'DELETE',
          uri: `${config.configapi}/api/Users/replicateDel?idUser=${user.Id}`,
        };
        //todo: SACA ERROR POR FALTA DE AUTHENTICACION, falta habilitar autorizacion HMAC en la api de configuración
        return rp(optsDelete).then(function() {
          //Eliminarmos el usuario pero igual lanzamos el error
          logger.error(err);
          logger.info('Rollback de creación de usuario en ASPNETUSERS de bd de configuración');
          throw err;
        });
      });
    });
  };
}
