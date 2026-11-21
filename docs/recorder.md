# Recorder

The recorder shows the gateway flight log in a terminal pane.

## Parts

- `GET /admin/flight/head` returns the log state and its cursor.
- `GET /admin/flight/events?after=N&wait=MS` returns the raw domain events after cursor N. If there are none, the gateway checks every 50 ms until `wait` ends. This is a long poll.
- `src/recorder/record.ts` calls the long poll in a loop. It prints one line per event and appends the event to a JSONL file.
- `src/recorder/pane.ts` opens the recorder in a Rex pane with `rex split`, reads it with `rex capture`, and closes it with `rex block close`.
- `src/recorder/replay.ts` applies `FlightLog.evolve` to recorded events and hashes the state. The hash is sha256 over canonical JSON with sorted keys.
- `bin/mcp-trust.ts` is the command line: `watch`, `record`, `replay`, `close`.

## Display modes

Full mode prints one line per event. Compact mode (`--compact` on `watch` and `record`) prints only calls, writes and refusals, one line each, 60 characters or fewer. It hides registration, `TargetsNamed` and reads. The JSONL file always holds every event.

Colors: red for refusals, green for allowed writes and pinned calls, yellow for a call that reached an unpinned provider with a same-name collision, dim for the rest. The recorder keeps a note of collisions for each session. It calls a provider a lookalike when its name extends the name of another provider in the same collision. This is a display rule only.

## What replay proves

Replay runs the view's own fold. It shows that the recording has every event, once, in order. It does not show that the fold is correct. The domain stories cover the fold.

## Limits

- A page is at most 20 events. A page of 200 hung the gateway when a recorder had a backlog of about 100 events, and a page of 80 never returned with a log of about 4,000 rows. Each listed event carries the full view state, so cost grows with the size of the log.
- If the connection drops, the recorder prints `mcp-trust waiting for the gateway`, retries every 500 ms, and resumes from the last event it wrote. `receipts/e3b-recorder-reconnect.json` shows 0 lost and 0 duplicated.

- The admin routes have no access control. Put Access in front of them before any deploy.
- The long poll reads a Durable Object every 50 ms for each open recorder.
- The log persists between local runs, so a run starts from the cursor from `/admin/flight/head`.
