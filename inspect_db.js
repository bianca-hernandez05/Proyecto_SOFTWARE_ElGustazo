const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'database', 'DB_ElGustado.db'));

db.all("SELECT name, sql FROM sqlite_master WHERE type='table'", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    rows.forEach(r => {
        console.log("=== TABLE: " + r.name + " ===");
        console.log(r.sql);
    });
    db.close();
});
