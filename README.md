# Hypercore Rehoster

Help host the hypercores of your choice.

Warning: still in alfa

The rehoster automatically pulls updates from all the cores it hosts.

The rehoster is recursive: if you rehost the key of another rehoster, you will automatically
also rehost all the cores contained in that rehoster (and if those also contain rehoster keys, you will host their cores as well, recursively).

Rehosters can host one other, in which case they will host the union of all their individual cores.

A Rehoster uses a corestore to store the hypercores on disk.

The db (hyperbee) containing the hosted hypercores is also stored in the corestore.
## Usage

See [example.js](example.js).

## Limitations

Currently a rehoster does not yet automatically detect when new hypercores are added
to one of the rehosters it helps recursively host.
Those new cores will be detected and rehosted only when a sync is executed for some other reason.

A workaround for now is to call sync once every hour or every day.
