# Recorder

The recorder shows the gateway flight log in a terminal pane.

## Parts

- `GET /admin/flight/head` returns the log state and its cursor.
- `GET /admin/flight/events?after=N&wait=MS` returns the raw domain events after cursor N. If there are none, the gateway checks every 50 ms until `wait` ends. This is a long poll.
- `src/recorder/record.ts` calls the long poll in a loop. It prints one line per event and appends the event to a JSONL file.
- `src/recorder/pane.ts` opens the recorder in a Rex pane with `rex split`, reads it with `rex capture`, and closes it with `rex block close`.
- `src/recorder/replay.ts` applies `FlightLog.evolve` to recorded events and hashes the state. The hash is sha256 over canonical JSON with sorted keys.
- `bin/mcp-trust.ts` is the command line: `watch`, `record`, `replay`, `close`.

## What replay proves

Replay runs the view's own fold. It shows that the recording has every event, once, in order. It does not show that the fold is correct. The domain stories cover the fold.

## Limits

- The admin routes have no access control. Put Access in front of them before any deploy.
- The long poll reads a Durable Object every 50 ms for each open recorder.
- The log persists between local runs, so a run starts from the cursor from `/admin/flight/head`.
