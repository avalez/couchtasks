function(doc) {
  if (doc.type && doc.type === 'task' && !doc.check && doc.tags) {
    for (var tag in doc.tags) {
      if (doc.tags[tag] !== "") {
        emit([doc.tags[tag]], null)
      }
    }
  }
}