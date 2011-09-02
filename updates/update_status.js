function (doc, req) {
  doc.check = JSON.parse(req.query.status);
  if (doc.check) {
    doc.check_at = new Date();
  }
  return [doc, "updated"];
}