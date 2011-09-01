function(doc) {
  if (doc.tags) {
    for (var tag in doc.tags) {
      if (doc.tags[tag] !== "") {
        emit([doc.tags[tag]], null)
      }
    }
  }
}