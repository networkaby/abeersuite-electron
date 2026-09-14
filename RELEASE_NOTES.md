# AbeerSuite 1.3.7

Faster bill saving at the counter, and the groundwork that makes every future update
almost instant.

## Saving a bill is quicker

Saving a voucher used to make about 45 separate trips to the database. It now makes
about 23, and the screen comes back without waiting for the balance recalculation to
finish.

- **Save and post is one request.** Choosing "Save & Post" used to save the bill, come
  back, and then post it in a second request. It is now one.
- **A bill meant to be posted is posted from the start.** It used to be written as a
  draft and changed to posted a moment later — two versions of the same document. On a
  counter that also meant the same bill was sent up to the office twice. A draft is now
  only what somebody deliberately chooses to save as a draft.

## Updates will stop interrupting the counter

Until now, installing an update meant the counter shut down, unpacked around 670 MB of
program files with nothing on screen but a splash, and only then came back. On a busy
till that is several minutes of not being able to bill, and it happened on every single
release.

From this version on, the counter unpacks an update **quietly in the background while
you are still billing**, running gently enough that it does not slow the till down. When
the moment comes to restart, there is nothing heavy left to do — it simply swaps the old
program folder for the new one, which takes seconds however large the update is.

**Please note:** this version is the one that *brings* the new method. The update from
1.3.6 to 1.3.7 is still carried out the old, slower way, because a counter updates using
the mechanism it already has. The very next update after this one will be the first
quick one.

If anything is not right — not enough free disk space, or the program folder cannot be
written to — the counter quietly falls back to the old way of updating. It never gets
stuck, and a counter that cannot take the fast path still updates normally.
