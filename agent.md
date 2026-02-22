# SimpleTodo

> A minimal todo list app. Supports creating, listing, completing, and deleting tasks.
> All data is stored in the user's browser session (localStorage). No login required for this demo.

## Auth
- type: none
- note: This demo app requires no authentication. Data is local to the browser.

## Actions

### list_todos
- description: Returns all todo items for the current session
- params: none
- returns: Array of todo objects, each with id (string), title (string), completed (boolean), createdAt (ISO string)
- example: `window.__agent.list_todos({})`

### add_todo
- description: Creates a new todo item and adds it to the list
- params:
  - title (string, required): The text content of the todo item. Must be non-empty.
- returns: The created todo object with id, title, completed (false), createdAt
- example: `window.__agent.add_todo({ title: "Buy groceries" })`

### complete_todo
- description: Marks an existing todo item as completed. Idempotent — safe to call if already completed.
- params:
  - id (string, required): The unique ID of the todo item to mark complete
- returns: The updated todo object
- example: `window.__agent.complete_todo({ id: "abc123" })`

### uncomplete_todo
- description: Marks a completed todo item as not completed (undo complete)
- params:
  - id (string, required): The unique ID of the todo item to unmark
- returns: The updated todo object
- example: `window.__agent.uncomplete_todo({ id: "abc123" })`

### delete_todo
- description: Permanently deletes a todo item. Cannot be undone.
- params:
  - id (string, required): The unique ID of the todo item to delete
- returns: Confirmation object with id of deleted item
- example: `window.__agent.delete_todo({ id: "abc123" })`

### clear_completed
- description: Deletes all todo items that are marked as completed
- params: none
- returns: Object with count of deleted items
- example: `window.__agent.clear_completed({})`
