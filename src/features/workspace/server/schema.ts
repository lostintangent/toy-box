/** The versions of the tables owned by Workspace, in order. To change a table,
 * append a version. */
export default [
  `
    CREATE TABLE IF NOT EXISTS settings (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      value TEXT NOT NULL CHECK (json_valid(value))
    );
  `,
];
