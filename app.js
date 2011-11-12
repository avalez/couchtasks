var couchapp = require('couchapp')
  , path = require('path')
  ;

ddoc = { _id:'_design/couchtasks' };

ddoc.views = {
  complete : {
    map : function(doc) {
      if (doc.type && doc.type === 'task' && doc.status === "complete") {
          emit([doc.index || 0], {
            index: doc.index || 0,
            title:doc.title,
            rev:doc._rev,
            id: doc._id
          });
      }
    }
  },
  servers : {
    map : function(doc) {
      if (doc.type && doc.type === 'server') {
        emit([doc.index || 0], {
          rev:doc._rev,
          id:doc._id,
          server: doc.server,
          database:doc.database,
          username:doc.username,
          password:doc.password
        });
      }
    }
  },
  tags : {
    map : function(doc) {
      if (doc.type && doc.type === 'task' && !doc.check && doc.tags) {
        for (var tag in doc.tags) {
          if (doc.tags[tag] !== "") {
            emit([doc.tags[tag]], null)
          }
        }
      }
    },
    reduce: '_count'
  },
  tasks : {
    map : function(doc) {
      if (doc.type && doc.type === 'task') {
        var prefix = doc.check ? 'a' : 'z';
        emit([prefix, doc.index] || 0, null);
      }
    }
  }
};

ddoc.updates = {
  update_index : function (doc, req) {
    doc.index = parseFloat(req.query.index);
    return [doc, "updated"];
  },
  update_status : function (doc, req) {
    doc.check = JSON.parse(req.query.status);
    if (doc.check) {
      doc.check_at = new Date();
    }
    return [doc, "updated"];
  }
}

ddoc.filters = {
  taskFilter : function (doc, req) {
    if (doc._id.match("_design")) {
      return true;
    }
    return doc.type && doc.type === "task";
  }
}

ddoc.validate_doc_update = function (newDoc, oldDoc, userCtx) {   
  if (newDoc._deleted === true && userCtx.roles.indexOf('_admin') === -1) {
    //throw "Only admin can delete documents on this database.";
  } 
}

couchapp.loadAttachments(ddoc, path.join(__dirname, '_attachments'));

module.exports = ddoc;