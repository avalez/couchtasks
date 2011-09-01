function(doc) {
  if (doc.type && doc.type === 'task' && doc.status === "active") {
    emit([doc.index || 0], {
      index: doc.index || 0,
      title:doc.title,
      _rev:doc._rev,
      tags: doc.tags,
      _id:doc._id
    });
  }
};