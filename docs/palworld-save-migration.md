# Migrating a Palworld co-op world to the dedicated server

A runbook, written from doing it on `watson` on 2026-07-21 against Palworld
`v1.0.1.100619` (post "Tides of Terraria"). It ends with a **documented failure** —
fast travel does not survive — because every guide online implies this migration is
complete and it is not.

> **Scope.** This is manual operator work on the game server. It is not part of
> Reveille and needs none of it. Reveille only starts and stops whatever world the
> server is configured to load.

---

## Outcome: what actually transfers

| | |
|---|---|
| World, terrain, days elapsed | ✅ |
| Base camps and structures | ✅ |
| Pals (232 of them, here) | ✅ — but only with layers 1–4 below |
| Character level, stats, gear, inventory | ✅ — only with the host fix |
| Guild membership and base ownership | ✅ — only with the raw-blob patch |
| Base-camp **work assignments** | ⚠️ partially — see gotcha 2 |
| **Fast travel unlocks** | ❌ **does not transfer** — see "The ceiling" |

Doing nothing but copying the world (route A) gets you everything except the
character: you arrive as a fresh level 1 in your own fully-built world, and your
real character sits orphaned in the save.

---

## Before you start

**Back up everything, twice over.** The world lives in two places and both matter:

```powershell
# your local co-op world
$env:LOCALAPPDATA\Pal\Saved\SaveGames\<steamid>\<worldid>\
# the dedicated server's worlds
C:\steamcmd\steamapps\common\PalServer\Pal\Saved\SaveGames\0\
```

Copy both somewhere outside either tree. You will iterate several times.

**Know your two GUIDs.** The co-op host is *always*
`00000000000000000000000000000001` — a special local-host identity that dedicated
servers have no concept of. Your dedicated-server GUID is generated the first time
you join, and is the filename of the throwaway character that appears in
`Players\`.

---

## The procedure

### 1. Copy the world

Copy the world folder from the local save into the server's `SaveGames\0\`, then
point the server at it:

```ini
; PalServer\Pal\Saved\Config\WindowsServer\GameUserSettings.ini
DedicatedServerName=<worldid>
```

That one line is also how you switch between worlds later — see "Multiple worlds".

### 2. Delete the world's `WorldOption.sav`

**Not optional.** See gotcha 1. Move it aside rather than deleting; it only holds
respawn settings.

### 3. Rename the world folder

Give the server's copy a **new** world ID. See gotcha 4 — leaving it matching your
local folder means your client overwrites your original save's data.

```powershell
$newId = ([guid]::NewGuid().ToString("N")).ToUpper()
```

Update `DedicatedServerName` to match.

### 4. Start the server, join once, stop

This creates the throwaway character whose filename is your new GUID. Stop the
server afterwards — everything below edits files it holds open.

### 5. Run the four layers

Tooling: [`quadrantbs/palworld-hostfix-toolkit`](https://github.com/quadrantbs/palworld-hostfix-toolkit).
Install into a **venv**, not your global Python — the setup requires overwriting
files inside the installed `palworld-save-tools` package:

```bash
python -m venv .venv
./.venv/Scripts/python -m pip install -r requirements.txt
cp -r patched_palworld_save_tools/* .venv/Lib/site-packages/palworld_save_tools/
./.venv/Scripts/python scripts/fetch_ooz.py       # downloads libooz.dll, no compiler needed
export PALWORLD_OOZ_DLL_PATH=<abs path>/ooz/libooz.dll
```

Then, in order, against a **copy** of the world:

```bash
# Layer 0 — transplant the character onto the new identity
python scripts/migrate/fix_host_save.py <world> <NEW_GUID> 00000000000000000000000000000001 False

# Layers 1+2 — pal map keys and internal owners
#   the server DELETES any pal keyed to a nonzero PlayerUId
python scripts/migrate/fix_pal_keys.py <world>/Level.sav <new-guid-dashed> 00000000-0000-0000-0000-000000000001

# Layer 3 — guild member handles (wrong handles => guild dissolves, pals purged)
python scripts/migrate/fix_guild_handles.py <world>/Level.sav

# Layer 4 — character container slots (party / palbox / base)
#   a slot pointing at a nonexistent player is emptied and its pal collected
python scripts/migrate/fix_container_slots.py <world>/Level.sav

# Guild membership — raw byte patch, see gotcha 3
python scripts/migrate/fix_orphaned_ownership.py <world> 00000000000000000000000000000001 <NEW_GUID>
```

Expect consistent counts across layers 1–4 (here: 253 every time). Inconsistency
means something didn't match.

### 6. Verify before promoting

```bash
python scripts/diagnostics/recount_char_map.py <world>/Level.sav
python scripts/diagnostics/count_owners.py    <world>/Level.sav
```

You want the old GUID to appear **nowhere** as an owner, pals keyed to the *zero*
GUID, and exactly **one** player entry per real player. If you see more than one
entry for your GUID, see gotcha 5.

### 7. Promote and check fast

Copy the fixed world in and start the server. **Check in-game within the first
30 seconds.** The server autosaves on a 30-second timer and will overwrite your
fixed file with whatever it loaded. If anything is wrong, stop it immediately.

---

## The gotchas

### 1. `WorldOption.sav` silently overrides your server config

It travels with the world and takes precedence over `PalWorldSettings.ini`. Import
a co-op world and the server adopts your *local game's* settings — which means
**`RESTAPIEnabled=False` and a blank `AdminPassword`**.

Two consequences, one of them a security hole:

- The REST API goes away, so anything reading server state breaks. For Reveille
  this looks like the agent reporting `starting` forever, because `getState()`
  derives `running` from the REST API answering. The system is behaving correctly;
  the world is configured wrong.
- **A blank admin password is an unauthenticated admin interface.** Palworld binds
  the REST API to `0.0.0.0` and offers no bind-address setting, so on a box without
  a firewall rule you have just published it. See DECISIONS 012.

Delete the file. Symptom in the server log:

```
[LOG] REST accessed endpoint / Unauthorized (AdminPassword is empty)
```

### 2. The GVAS parser lags the game version — 162 bytes are lost

Run the toolkit's round-trip test *before* trusting it:

```bash
python scripts/diagnostics/roundtrip_test.py <world>/Level.sav
```

On this save it reported `byte-for-byte match: False` — **162 bytes lost on a
read-then-write with no edits at all**, alongside 14 warnings of the form:

```
Unknown EPalWorkTransformType, please report this: 67: EPalWorkableType::Progress
```

Those are base-camp work assignments and build progress. ~11 bytes each across 14
entries accounts for the loss. This is not specific to one tool: every current
option sits on `palworld-save-tools` for GVAS parsing, so they all lose it.

**Run the round-trip test first and decide knowingly.** We accepted the loss.

### 3. Guild data is in a struct the parser cannot read

`GroupSaveDataMap` guild blobs fail to decode on this version:

```
Warning: failed to decode group EPalGroupType::Guild, keeping raw bytes
```

Layers 3 and 4 fix the *pal* handles inside it, but your **player** membership and
admin ownership survive only as opaque bytes. `fix_orphaned_ownership.py` patches
them by raw byte-pattern replacement — and it only works because it builds the
pattern with the library's own `UUID` class.

**On-disk GUIDs are Microsoft-style mixed-endian.** The old host GUID is stored as:

```
00000000000000000000000001000000     <- note the 01 at byte 12, not the end
```

`bytes.fromhex("00000000000000000000000000000001")` matches **zero** occurrences,
reports success, and changes nothing. Use:

```python
from palworld_save_tools.archive import UUID
UUID.from_str("00000000-0000-0000-0000-000000000001").raw_bytes
```

Symptom if you skip it: everything works but you are not in your own guild, and
your bases are not yours.

### 4. The world ID collides with your client's local folder

The copied world keeps its ID, so `<worldid>` now exists both on the server **and**
in your client's `%LOCALAPPDATA%\Pal\Saved\SaveGames\<steamid>\`. Your client
cannot tell them apart and reuses the local folder for the server session —
**overwriting your original co-op save's client data.** Observed here: local
`LocalData.sav` went from 38,764 bytes (the co-op session) to 10,441 bytes while
joining the server.

Rename the server's copy to a fresh GUID (step 3). Do it *before* joining.

### 5. Every failed join leaves an orphan character record

Each time you join before the fix is complete, the server writes another player
record. After two attempts `CharacterSaveParameterMap` held **three** entries under
one GUID — `operapoulet` (level 34, the real one) plus `operapoulet2` and
`operapoulet3`, both empty.

Check with `recount_char_map.py`; a player should have exactly one. Removing the
orphans is safe — keep the InstanceId your player `.sav` points at:

```python
sd["IndividualId"]["value"]["InstanceId"]["value"]   # the one to keep
```

---

## The ceiling: fast travel does not transfer

**Unlocked fast-travel points do not come across, and we could not make them.**

What was verified, so nobody repeats the search:

- Your player save **does** contain `FastTravelPointUnlockFlag` with the correct
  entries set `true` — more than a natively-created character has — and
  `UnlockedWorldMapFlags`.
- `PlayerUId` and `IndividualId.PlayerUId` are both correctly remapped.
- `Level.sav` contains **no fast-travel data at all** — not the point IDs, not even
  a matching string. Those IDs are global game data, not world state.
- Neither breaking the world-ID collision (gotcha 4) nor removing the orphan
  character records (gotcha 5) changed the outcome.

So the save-side data is correct and complete, and the server does not apply it.
The remaining explanation is in how the server initialises a joining player's
record, which is reverse-engineering rather than migration.

**The practical answer is to re-visit the statues.** Tedious; not data loss.

---

## Multiple worlds

The server picks its world from one line:

```ini
DedicatedServerName=<worldid>
```

Worlds live side by side in `SaveGames\0\` and switching is that edit plus a
restart. Reveille's `/start` and `/stop` are unaffected — they act on whatever is
configured.

There is no way to choose a world from Discord, deliberately: that would be a new
capability with a new surface, and the architecture's acceptance test asks whether
a change adds a new *kind* of thing or a new *row*. An admin console is the natural
home if this ever stops being a manual operation.

---

## Recovery

Every step here is reversible if you snapshot before each promotion. Keep them
timestamped:

```
save-backups\<stamp>-before-guid-rename
save-backups\<stamp>-before-promoting-fixed
save-backups\<stamp>-before-guild-patch
save-backups\<stamp>-before-orphan-drop
```

Palworld also keeps its own rolling backups inside the world folder under
`backup\<timestamp>\`, which saved more than one intermediate state here.

If you ever want the original co-op world playable locally again, restore the
client-side folder too — gotcha 4 means it was probably overwritten.
