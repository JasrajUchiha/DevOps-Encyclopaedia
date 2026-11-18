# System Design Notes

Fundamentals from the ByteByteGo system design series (Alex Xu), rewritten as a reference. Numbers are order-of-magnitude, not a benchmark of one machine.

---

## Table of Contents

- [Memory](#memory)
- [ROM, Firmware, and BIOS](#rom-firmware-and-bios)
- [Storage](#storage)
- [DNS](#dns)
- [Latency Numbers](#latency-numbers)
- [REST APIs](#rest-apis)
- [Data Structures](#data-structures)
- [Cache Friendliness](#cache-friendliness)

---

## Memory

**RAM (Random Access Memory)** is the working memory the CPU reads and writes while a program runs. It is fast and **volatile**: power off, data gone.

| Type | Full idea | Why it exists |
|------|-----------|---------------|
| **SRAM (Static RAM)** | Each bit is a small circuit of transistors. It holds the bit as long as power is on. No refresh. | Fastest RAM. Used for **CPU caches** (L1, L2, L3). Expensive and bulky per bit, so caches are megabytes, not gigabytes. |
| **DRAM (Dynamic RAM)** | Each bit is a capacitor. Charge leaks, so the chip must be **refreshed** thousands of times a second. | Main memory. Cheaper and denser than SRAM. **DDR4** and **DDR5** are generations of this (your notes said DDR6; the common desktop/server generations are DDR4 and DDR5). |
| **GDDR (Graphics DDR)** | DRAM tuned for very high bandwidth, not the lowest latency. **GDDR6** is a common GPU generation. | GPUs move huge blocks of pixels and tensors in parallel. Bandwidth matters more than a single random lookup. |

**Use cases**

- SRAM: keep the next few instructions and hot variables next to the CPU.
- DRAM: the process heap, database buffer pool, Redis dataset.
- GDDR / GPU memory: training a model, rendering a frame, video encode.

**Nuance:** "RAM" in a laptop spec is DRAM. The caches inside the CPU are SRAM and are usually not advertised as "RAM." Apple M-series chips use **unified memory**: CPU and GPU share one DRAM pool, so a copy between "CPU RAM" and "GPU RAM" is often avoided.

---

## ROM, Firmware, and BIOS

**ROM (Read-Only Memory)** keeps instructions that must survive power-off. Modern chips are usually **flash** that can be updated, not truly write-once ROM.

| Piece | Job |
|-------|-----|
| **Firmware** | Software stored on the device itself. It tells that piece of hardware how to start and how to talk to the rest of the machine (disk controller, NIC, keyboard, SSD). |
| **BIOS (Basic Input/Output System)** | The first program a traditional PC runs. It checks hardware (**POST — Power-On Self-Test**), then hands off to a bootloader on disk. |
| **UEFI (Unified Extensible Firmware Interface)** | The modern replacement for BIOS. Same job: start the machine, then load the OS. Most "BIOS settings" screens today are UEFI. |

**Use case:** a firmware bug in an SSD or NIC is why vendors ship firmware updates. A bad update can brick the device, so production fleets stage them.

**Nuance:** the operating system does not start from nothing. Firmware finds a boot disk, the bootloader finds the kernel, the kernel starts processes. If DNS, disks, or the OS look "down" before any of your code runs, the fault may still be firmware or boot config.

---

## Storage

| | **HDD (Hard Disk Drive)** | **SSD (Solid State Drive)** |
|--|---------------------------|-----------------------------|
| Medium | Spinning magnetic platters, moving head | Flash chips, no moving parts |
| Strength | Cheap per terabyte | Fast, especially random reads |
| Weakness | Seek time (milliseconds) when the head moves | More expensive; flash wears out after many writes |
| Typical job | Bulk logs, backups, cold data | Databases, OS disk, search indexes |

**Interfaces** (how the drive talks to the computer):

| Interface | Path | Latency |
|-----------|------|---------|
| **SATA (Serial ATA)** | SSD or HDD through a storage controller. Shared, older link. | Fine for HDDs. Caps SSDs. |
| **NVMe (Non-Volatile Memory Express)** | SSD talks over **PCIe (Peripheral Component Interconnect Express)** lanes, closer to the CPU. | Lower latency and much higher throughput than SATA SSDs. Default for databases and boot disks. |

**Use cases**

- Put the database and write-ahead log on NVMe.
- Put backups and rarely read archives on HDD or object storage.
- Do not assume "SSD" means NVMe. A SATA SSD is still an SSD and still much slower than NVMe on random I/O.

**Nuance:** sequential throughput (streaming a big file) and random latency (fetching one 8 KB page) are different budgets. Databases suffer on random reads. HDDs are acceptable when the head rarely seeks. **fsync** (telling the drive "this write must be durable") is often slower than a raw write because the drive must confirm the data is safe.

---

## DNS

**DNS (Domain Name System)** is the internet's directory. It turns a name people type (`google.com`) into an **IP (Internet Protocol)** address machines use.

### Who is involved

| Role | What it does |
|------|----------------|
| **Stub resolver** | The OS library. The browser asks it. |
| **Recursive resolver** | Does the lookup work and caches answers. Often your **ISP (Internet Service Provider)**, or a public resolver: Cloudflare `1.1.1.1`, Google `8.8.8.8`. |
| **Authoritative nameserver** | Holds the real records for a domain. Updating ownership or an address means updating this server (or the zone it serves). |

### How the resolver finds the authoritative server

There is a hierarchy. The recursive resolver walks it when the answer is not already cached.

1. **Root nameservers.** They do not know `google.com`. They know who serves each **TLD (Top-Level Domain)** such as `.com`, `.eu`, `.info`. There are **13 root server identities** (named A through M). Each identity is many machines worldwide, reached by **anycast** (the same IP is announced from many sites, and routing sends you to a nearby one).
2. **TLD nameservers.** The `.com` servers know which authoritative servers are listed for `google.com`. They do not hold Google's web IP.
3. **Authoritative nameservers.** These return the actual record (usually an A or AAAA address).

**Flow for `google.com`**

```text
Browser → OS → recursive resolver
  resolver → root        → "ask this .com server"
  resolver → .com TLD    → "ask Google's authoritative servers"
  resolver → authoritative → IP address
  resolver → OS → browser
```

Each step is cached. The next user often skips the walk.

### Records you will see

| Record | Meaning |
|--------|---------|
| **A** | Name → IPv4 address |
| **AAAA** | Name → IPv6 address |
| **CNAME** | Name → another name (then look that up) |
| **NS** | Which servers are authoritative for the zone |
| **MX** | Mail servers |
| **TXT** | Free text: SPF, domain verification |
| **TTL** | **Time To Live.** How long a resolver may cache this answer. |

### Changing a record

Propagation feels slow because caches keep the old answer until **TTL** expires. Some resolvers also ignore TTL.

**Safe cutover**

1. Lower the TTL (for example to 60 seconds) **well before** the change, and wait out the old long TTL.
2. Change the record.
3. Leave the **old servers running** until traffic on the old IP actually dies. Then shut them down.

**Use cases:** blue/green deploys, moving a site to a new load balancer, failing over to another region.

**Nuance:** DNS is not a load balancer by itself, but multiple A records plus short TTLs are a crude way to shift traffic. Health-checked DNS (Route 53, Cloudflare) only helps after caches expire. A one-hour TTL means a bad change can linger for an hour.

---

## Latency Numbers

Use these to decide **where** a design will hurt. A round trip inside one data center is not "free" next to a CPU cache hit, and it is cheap next to a cross-ocean call.

| Range | What usually lives here |
|-------|-------------------------|
| **&lt; 1 ns** | CPU register access. One clock cycle of a modern CPU is also under a nanosecond (a 3 GHz chip ticks about every 0.3 ns). |
| **1–10 ns** | L1 and L2 cache. A **branch mispredict** often wastes on the order of 10–20 cycles, so it lands in this band too. |
| **10–100 ns** | L3 cache. A DRAM access is often toward the **top** of this band (~50–100 ns). Apple M-series unified memory is in this neighborhood, not in microseconds. |
| **100 ns–1 µs** | A simple **system call** (your program → C library → kernel). Hashing a tiny input (for example MD5 of 64 bits) is also tiny compared with I/O. |
| **1–10 µs** | Kernel **context switch** between processes or threads. |
| **10–100 µs** | A small HTTP request handled inside a local proxy. Reading ~1 MB **sequentially** from RAM. A random **SSD page** read (about 8 KB) on NVMe often sits here. |
| **100 µs–1 ms** | A local **Redis or Memcached** GET that stays on the same machine or a very close neighbor. NVMe writes are often in the tens or hundreds of microseconds; an **fsync** can approach 1 ms. |
| **~0.5–2 ms** | **Same availability zone** network round trip (app server → Redis/database in the same zone and back). This is the usual "intra-zone" number. Do not mix it up with a local in-process cache hit. |
| **1–10 ms** | **Cross-zone** round trip in the same region (another availability zone). HDD **seek**. |
| **10–100 ms** | US West ↔ US East, or US East ↔ UK, and back. |
| **100 ms–1 s** | Long global paths. **bcrypt** of a password is often ~100–300 ms on purpose (so stolen hashes are slow to crack). A **TLS (Transport Layer Security)** handshake US ↔ Singapore. Reading ~1 GB sequentially from a fast SSD. |
| **1 s and up** | Moving a gigabyte across the network. At **1 Gbps**, 1 GB is on the order of **8–10 seconds**. A 10 Gbps link makes that about 1 second. The limit is bandwidth, not DNS. |

**How to use this in design**

- Touch DRAM and caches in tight loops. Do not cross the network inside a per-pixel or per-key loop.
- One Redis GET in the same zone is fine. A hundred of them per user request is a latency bug. Batch or pipeline.
- Anything that round-trips across regions belongs off the critical path, or the UI will feel slow.
- Password hashing **should** be slow. Everything else on the login path should not copy that cost.

**Nuance:** these are planning numbers from the "latency numbers every programmer should know" tradition, updated for the 2020s. Measure your own cloud. Same-zone RTT and NVMe latency move with instance type and disk generation.

---

## REST APIs

**REST (Representational State Transfer)** is the common style for web APIs. It is **not** a strict specification. It is a set of rules people have used since the early 2000s, usually over **HTTP (Hypertext Transfer Protocol)**.

### Six constraints

| Constraint | Meaning | Practical take |
|------------|---------|----------------|
| **Client–server** | UI and data store evolve separately. The client does not care how the database is sharded. | Mobile app and API can ship on different schedules. |
| **Stateless** | Each request carries everything the server needs (auth token, filters, body). The server does not remember "this client was on step 2." | Any API server can handle the next call. Sessions, if you need them, live in a token or in Redis, not in process memory. |
| **Cacheable** | Responses say whether they can be cached (`Cache-Control`, `ETag`). | GET of a product can sit in a CDN. POST of a payment must not. |
| **Uniform interface** | Same rules for every resource: a **URI (Uniform Resource Identifier)** names it, the body is a **representation** (usually JSON), and verbs are the standard HTTP methods. | Clients learn one pattern, not one custom verb per screen. |
| **Layered system** | The client cannot tell if it hit the origin, a gateway, a cache, or a load balancer. | You can insert a CDN or an auth proxy without rewriting clients. |
| **Code on demand** (optional) | The server may send code for the client to run (JavaScript). Rarely part of an API design discussion. | Almost nobody depends on this for JSON APIs. |

**HATEOAS (Hypermedia as the Engine of Application State)** is the strict reading of the uniform interface: responses include links to the next valid actions. Most production "REST" APIs skip this and still call themselves REST. Interviewers usually want resources, verbs, status codes, and statelessness, not a hypermedia thesis.

### Resources and URIs

A resource is a noun. The URI names **one** thing or a collection.

```text
GET    /v1/products
POST   /v1/products
GET    /v1/products/42
PUT    /v1/products/42
PATCH  /v1/products/42
DELETE /v1/products/42
```

Prefer `/v1/products`, not `/v1/getAllProducts`. The verb belongs in the HTTP method.

| Method | Typical use | Safe (no change) | Idempotent (repeat = same result) |
|--------|-------------|------------------|-------------------------------------|
| **GET** | Read | Yes | Yes |
| **POST** | Create, or any non-idempotent action | No | **No.** Two POSTs can create two orders. |
| **PUT** | Replace the whole resource | No | Yes |
| **PATCH** | Change some fields | No | Usually, if the patch is "set these fields" |
| **DELETE** | Remove | No | Yes. Deleting twice still leaves it gone. |

The body is optional and is usually **JSON (JavaScript Object Notation)**.

**Nuance:** "idempotent" means the **server state** ends the same, not that the status code is identical. A second DELETE may return 404. Clients and retries still treat DELETE and PUT as safe to retry. POST needs an **idempotency key** (a client-generated id the server stores) if a retry must not double-charge.

### Status codes

| Band | Meaning | Codes worth knowing |
|------|---------|---------------------|
| **2xx** | Success | **200** OK, **201** Created, **204** No Content |
| **3xx** | Redirect / cache | **301** moved, **304** Not Modified (cache still valid) |
| **4xx** | The **client** request is wrong | **400** bad input, **401** not logged in, **403** logged in but forbidden, **404** missing, **409** conflict, **429** too many requests |
| **5xx** | The **server** (or a downstream it called) failed | **500** bug, **502** bad gateway, **503** overloaded or down, **504** gateway timeout |

Do not return 200 with `{"error": true}` if you can use a real status. Load balancers and clients key off the code.

### Pagination

A list endpoint must not return a million rows.

**Offset pagination**

```text
GET /v1/products?limit=25&offset=50
```

- `limit` = page size
- `offset` = how many rows to skip

Simple to build. Weak on large offsets: the database still walks and throws away the first 50, 5000, or 500000 rows. If a row is inserted or deleted, the same offset can **skip or repeat** items.

**Cursor (keyset) pagination**

```text
GET /v1/products?limit=25&cursor=eyJpZCI6NDJ9
```

The cursor is "the last item you saw" (often an id or a created-at plus id). The next query is `WHERE id > 42 ORDER BY id LIMIT 25`. Stable and cheap on big tables. Harder to jump to "page 40."

**Use offset** for small admin tables. **Use a cursor** for feeds, logs, and anything that grows without bound.

### Versioning

Ship a new shape without breaking old clients. Give them time to move.

| Style | Example | Tradeoff |
|-------|---------|----------|
| Path | `/v1/products`, `/v2/products` | Obvious. Easy to route. Clutters URLs. |
| Header | `Accept: application/vnd.shop.v2+json` | Clean URLs. Easier to forget in a curl. |
| Query | `?version=2` | Easy and easy to abuse. Least common in public APIs. |

Keep old versions until metrics show the callers are gone. Do not reuse a field to mean something new.

### When not REST

| Style | Use it when |
|-------|-------------|
| **GraphQL** | A client needs to pick its own fields, or mobile wants one round trip for a screen made of many resources. You pay with harder caching and a query-cost problem (one query can be huge). |
| **gRPC** | Service-to-service calls inside the data center. Binary **Protocol Buffers** over HTTP/2. Strong types, streaming, low CPU. Awkward in a browser without a proxy. |
| **REST** | Public APIs, browsers, and anything a third party will call with curl. |

---

## Data Structures

Pick the structure for the **access pattern**, not because it is famous.

| Structure | Shape | Everyday use | Watch out |
|-----------|--------|--------------|-----------|
| **Array** | Fixed-size, contiguous, ordered | Math on a series (temperatures over time), pixels in a 2D grid, any random access by index | Size is fixed. Inserting in the middle shifts everyone. |
| **Dynamic array / list** | Ordered, grows at the end | Task lists, a social feed in display order, language "lists" (Python list, Java ArrayList) | Append is cheap. Insert at the front is not, unless it is a real linked list. |
| **Linked list** | Ordered nodes with pointers | Rare in application code. Shows up inside LRU caches and some queues | No fast index. Pointer chasing is cache-unfriendly. |
| **Stack** | **LIFO (Last In, First Out)** | Undo/redo, browser back/forward, call stack, depth-first search | You only touch the top. |
| **Queue** | **FIFO (First In, First Out)** | Printer jobs, chat send order, background jobs, game input | Fairness: first request is served first. Use a **deque** if you need both ends. |
| **Heap / priority queue** | Partial order by priority | Task schedulers, "next soonest timer," Dijkstra's shortest path, top-K | You get the min or max fast. You do not get a sorted list for free. |
| **Tree** | Hierarchy | File systems, org charts, decision trees in ML, indexes | Shape matters. A skinny tree is just a slow list. |
| **B-tree / B+ tree** | Short, wide tree | The usual index inside a relational database. Tuned to disk page size | Range scans are good. The DB picks this; you usually create an index, not the tree. |
| **Hash table** | Key → value via a hash function | Caches, dictionaries, compilers (symbol tables), "have I seen this id?" | Average O(1) lookup. Worst case degrades if hashes collide. No order. |
| **Suffix tree / suffix array** | Every suffix of a string | "Find this phrase in a huge document," some DNA and editor searches | Heavy to build. Search engines more often use an **inverted index** (word → documents) than a suffix tree. |
| **Graph** | Nodes and edges | Social networks, road maps, recommendation ("people who bought X"), dependency graphs | "Shortest path" and "who is connected" are graph questions. Do not force them into a table walk. |
| **R-tree** | Tree over rectangles in space | Maps, "points of interest near me," collision detection | The spatial cousin of a B-tree. Databases and geo indexes hide it behind a query. |

**Nuance for interviews**

- **Array vs list:** say whether you mean a contiguous array or a linked list. Cache behavior is opposite.
- **Hash vs tree:** hash is faster for exact key lookup. A balanced tree keeps order and supports ranges (`created_at` between two times).
- **Heap vs sorted array:** a heap finds the current top priority quickly and is cheaper to update. A sorted array is better if you constantly read items in full order.
- **Graph in a system design:** the product is a graph (followers, routes). The storage might still be a table of edges (`from_id`, `to_id`) plus a cache. You do not need a "graph database" until traversals of many hops are the product.

---

## Cache Friendliness

CPUs fetch memory in **cache lines** (often 64 bytes), not one byte at a time. If the next thing you need is already in that line, you hit. If the next node is somewhere else in RAM, you miss and wait.

| Layout | Example | Typical behavior |
|--------|---------|------------------|
| **Contiguous** | Array, dynamic array, B-tree page full of keys | High hit rate. Walking 1,000 ints is a sequential scan. Rough mental picture: on the order of **80% hits** when the working set is hot and access is sequential. |
| **Pointer chasing** | Linked list, naive tree, objects scattered on the heap | Each step can jump to a cold cache line. Hit rate can fall toward **~30%** on a pointer-heavy walk. The CPU spends the time waiting on DRAM. |

Those hit rates are a teaching picture, not a law. They depend on size, access pattern, and cache level.

**Use this when**

- A hot loop should store data in arrays of plain values (**struct of arrays**), not an array of pointers to heap objects.
- Database pages and Redis objects are cache-friendly when you read the fields you stored together, and unfriendly when you load a huge value to use one field.
- "Big O is the same" can still lose. An array and a linked list are both O(n) to scan. The array usually wins by a wide margin because of caches and prefetch.

**Nuance:** hash tables are contiguous buckets plus possible pointer chains. They are friendlier than a linked list for lookup, and less friendly than a dense array for a full scan. Column stores pack one field together so analytics scans stay sequential. Row stores pack one record together so "load this user" stays one fetch.
