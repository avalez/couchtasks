function(doc) {
  if (doc.type && doc.type === 'task') {
    emit(doc.index || 0, null);
  }
};