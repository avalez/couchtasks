function(doc) {
  if (doc.tags) {
    for (var tag in doc.tags) {
      emit([doc.tags[tag]], null)
    }
  }
}