function(doc) {
  if (doc.type && doc.type === 'task') {
    var prefix = doc.check ? 'a' : 'z';
    emit([prefix, doc.index] || 0, null);
  }
};