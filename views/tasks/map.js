function(doc) {
  if (doc.type && doc.type === 'task') {
    var index = doc.index || 0;
    if (doc.check) {
      index -= 1000;
    }
    emit(index, {
      _id: doc._id,
      _rev: doc._rev,
      check: doc.check,
      check_at: doc.check_at,
      index: index,
      title: doc.title,
      tags: doc.tags
    });
  }
};