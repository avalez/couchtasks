function (doc, req) {
  doc.check = JSON.parse(req.query.status);
    return [doc, "updated"];
}