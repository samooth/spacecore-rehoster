const sqlite3 = require('better-sqlite3')
const { validateKey } = require('hexkey-utils')

const HEX_KEY = 'hexKey'

class DbInterface {
  constructor (db) {
    this.db = db
    this.initTables()
  }

  initTables () {
    const command = this.db.prepare(
      [
        'CREATE TABLE IF NOT EXISTS core (',
        'id INTEGER PRIMARY KEY,',
        `${HEX_KEY} TEXT UNIQUE NOT NULL`,
        ');'
      ].join(' ')
    )
    command.run()
  }

  addHexKey (hexKey) {
    validateKey(hexKey)

    const command = this.db.prepare(
      `INSERT INTO core (${HEX_KEY}) VALUES (?);`
    )
    command.run(hexKey)
  }

  getHexKeys () {
    const command = this.db.prepare(
      `SELECT ${HEX_KEY} FROM core;`
    )
    const keys = command.all().map(row => row[HEX_KEY])
    return new Set(keys)
  }

  static initFromConnectionStr (connectionStr) {
    const db = sqlite3(connectionStr)
    return new DbInterface(db)
  }
}

module.exports = DbInterface
