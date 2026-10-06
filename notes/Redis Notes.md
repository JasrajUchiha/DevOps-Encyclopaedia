# Redis Notes

Redis is an **in-memory, key-value data store**. It keeps the working set in RAM for sub-millisecond reads and writes, and can persist to disk so a restart does not wipe everything.

It is more than a cache. Values are typed **data structures** (strings, lists, hashes, sets, sorted sets, JSON, streams, vectors, and more). One process can be cache, session store, queue, leaderboard, and search index depending on the key design.

---

## Table of Contents

- [What Redis Is](#what-redis-is)
- [Products](#products)
- [Connecting](#connecting)
- [Keys, Strings, and Keyspaces](#keys-strings-and-keyspaces)
- [Lists](#lists)
- [Sets](#sets)
- [Hashes](#hashes)
- [Sorted Sets](#sorted-sets)
- [JSON](#json)
- [Streams, Geo, Bitmaps, Time Series, Vectors](#streams-geo-bitmaps-time-series-vectors)
- [Probabilistic Structures](#probabilistic-structures)
- [Key Expiration](#key-expiration)
- [Persistence (RDB vs AOF)](#persistence-rdb-vs-aof)
- [Eviction Policies](#eviction-policies)
- [Common Use Cases](#common-use-cases)
- [Redis Cloud Operator](#redis-cloud-operator)
- [Essentials vs Pro](#essentials-vs-pro)
- [Durability and Replication Settings](#durability-and-replication-settings)
- [Architecture: Shard, Database, Node, Cluster](#architecture-shard-database-node-cluster)
- [High Availability and Scaling](#high-availability-and-scaling)
- [Proxy Policies](#proxy-policies)
- [Subscriptions](#subscriptions)
- [Backup and Migration](#backup-and-migration)
- [Security](#security)
- [Networking](#networking)
- [Monitoring](#monitoring)
- [Automation](#automation)

---

## What Redis Is

| Trait | Meaning |
|-------|---------|
| Memory-first | Hot data lives in RAM. Disk is for durability, not the primary read path. |
| Key-value | Every piece of data has a **key**. The value is a typed structure, not only a blob. |
| Single-threaded commands (classic) | One Redis process (shard) runs commands one at a time. High ops/sec comes from being in memory and avoiding locks, not from many cores per shard. |
| Optional persistence | Snapshots and/or append-only log on disk. |

**Use when:** you need very fast access, simple data models, pub/sub or streams, atomic counters, or a cache in front of a slower store.

**Do not use as:** the only copy of data you cannot rebuild, unless persistence, replicas, and backups are designed on purpose. RAM is expensive; huge cold datasets belong on disk (or Auto Tiering).

---

## Products

| Product | What it is |
|---------|------------|
| **Redis Open Source** (Community) | You run it. One process, optional replica, Cluster mode for sharding. Numbered logical databases (`SELECT 0` …) exist **inside** one instance. |
| **Redis Cloud** | Fully managed. Subscriptions, databases, endpoints, backups, VPC peering. |
| **Redis Software** (Enterprise, self-managed) | Same clustering ideas as Cloud (shards, proxy, multi-tenancy) but you operate the nodes. |

Open Source **logical databases** (`SELECT 1`) are not the same thing as a Redis Cloud **database**. Cloud databases can span many shards. See [Architecture](#architecture-shard-database-node-cluster).

---

## Connecting

Connect with **Redis Insight** (GUI), **redis-cli**, or a client library (**redis-py** for Python, **Jedis** / Lettuce for Java, go-redis, etc.).

Local development: run a container and exec in, or point redis-cli at `localhost:6379`.

```bash
docker run -d --name redis -p 6379:6379 redis
redis-cli -h localhost -p 6379
```

Cloud: use the **public** or **private** endpoint plus username and password (Access Control List user, not only `default`). Prefer TLS.

> **Security:** never paste real passwords into this file. Rotate any secret that was stored in notes. Prefer a secrets manager or environment variables.

---

## Keys, Strings, and Keyspaces

By default a new key holds a **string**. Strings can also hold integers (for `INCR`) and binary data.

```text
SET color red
GET color
UNLINK color          # delete; returns how many keys were removed (0 if missing)
```

`UNLINK` is like `DEL` but the memory free can happen in the background. Prefer `UNLINK` for large values.

**Keyspaces** are a naming convention, not a Redis feature. Use prefixes so keys are readable and easy to scan, expire, or delete by pattern (still: avoid `KEYS *` in production; use `SCAN`).

```text
SET btc:config:paymentserver:hostname payment.paytm.com
SET product:6379:name "Awesome Bowtie"
SET product:6379:color red
SET product:6379:category bowties
```

**Why prefixes:** IDs alone (`6379`) do not tell you product vs location vs vendor. `product:6379:name` does.

**String extras (see docs):** `INCR` / `DECR`, `GETRANGE` / `SETRANGE`, bitwise ops (`GETBIT`, `SETBIT`). Counters, rate-limit windows, and feature flags often live on strings.

**Nuance:** one hash per product (`product:6379` with fields `name`, `color`) is usually better than many string keys if you always load the whole record.

---

## Lists

An **ordered** collection of strings. Order is insertion order, **not** sorted by value.

- **Left** = head
- **Right** = tail

| Command | Effect |
|---------|--------|
| `LPUSH` | insert at head; returns new length |
| `RPUSH` | insert at tail |
| `LPOP` | remove head |
| `RPOP` | remove tail |
| `LLEN` | length |
| `LRANGE key start stop` | inclusive range; `0 -1` is the whole list |
| `LINDEX key index` | one element; `0` is head, `-1` is tail |

```text
LPUSH products:recent:alice BOWTIE42
LPUSH products:recent:alice BOLOTIE23
LPUSH products:recent:alice ASCOT13
LLEN products:recent:alice
RPOP products:recent:alice     # BOWTIE42 — first in, first out if you LPUSH + RPOP
LRANGE products:recent:bob 0 -1
LINDEX products:recent:bob 0
```

This is **not** a Python list. `LPUSH` prepends. Three `LPUSH`es then `RPOP` removes the **oldest** item (queue). `LPUSH` + `LPOP` is a **stack**.

**Use cases**

- Recent items (viewed products) — cap with `LTRIM`
- FIFO queue for background jobs (`LPUSH` / `BRPOP`)
- Stack / breadcrumb trail
- Activity feed (with a max length)

**Nuance:** lists are O(N) to index in the middle. Do not use a giant list as a random-access table. Blocking pops (`BLPOP`, `BRPOP`) beat polling for workers.

---

## Sets

**Unordered unique** strings. A bag with no duplicates. Set algebra is built in: `SUNION`, `SINTER`, `SDIFF`.

```text
SADD product:views:bowtie42 alice bob chuck dave   # returns how many were new
SMEMBERS product:views:bowtie42
SCARD product:views:bowtie42                       # cardinality
SREM product:views:bowtie42 chuck dave
SISMEMBER product:views:bowtie42 alice
```

**Use cases**

- Unique visitors / unique viewers of an SKU
- Tags (`product:6379:tags`)
- Dedup a batch before writing elsewhere
- “Users who like A and B” via `SINTER`

**Nuance:** `SMEMBERS` on a huge set blocks the shard. Prefer `SSCAN`. For “is this ID new?” at huge scale, a Bloom filter is cheaper than a set.

---

## Hashes

A Redis hash is a **map of fields → values** under one key (like a Python dict). Redis itself is a giant keyspace; a hash is a nested map inside one key.

```text
HSET product:bowtie42 name "Awesome Bowtie"
HSET product:bowtie42 sku BOWTIE42 name "Awesome Bowtie" color red quantity 23
HGET product:bowtie42 name
HGETALL product:bowtie42
HINCRBY product:bowtie42 quantity -1
```

**Use cases**

- Session blob (`session:<id>` → user id, cart, expiry metadata)
- Shopping cart line items
- User profile / product record
- Cache of a relational row (invalidate on write)

**Nuance:** `HGETALL` on a hash with thousands of fields is expensive. Field-level get/set is the point. Search/index hashes with **Redis Query Engine** (RediSearch) rather than scanning every key.

---

## Sorted Sets

Set uniqueness **plus** a numeric **score**. Members are unique; scores can collide. Rank 0 = lowest score (unless you reverse).

Query by **rank** (index) or by **score** range.

```text
ZADD product:rank 4.5 BOWTIE42
ZADD product:rank 4.8 BOLOTIE23 3.2 ASCOT13 4.9 BONDTIE007
ZSCORE product:rank BOWTIE42
ZRANK product:rank BOWTIE42
ZRANGE product:rank 0 -1 WITHSCORES
ZRANGE product:rank 4 5 BYSCORE WITHSCORES    # scores 4 through 5 inclusive
```

**Use cases**

- Game / sales **leaderboards** (live rank)
- Time-ordered feeds (score = unix time)
- Delay queues (score = when to run)
- Simple recommendations (intersect / weight scores)

**Nuance:** one member cannot have two scores. Updating the score is `ZADD` again. For sliding windows, `ZREMRANGEBYSCORE` to drop old events.

---

## JSON

Store a JSON document **without** stuffing it into a string you parse in the app. Path queries use **JSONPath**. Indexing and search still work with the query engine (see docs).

```text
JSON.SET product:bowtie42 $ '{"sku":"BOWTIE42","name":"Awesome Bowtie","colors":["red","green","blue"],"quantity":23,"onsale":false}'
JSON.GET product:bowtie42
JSON.GET product:bowtie42 $.quantity
JSON.GET product:bowtie42 $.*
JSON.SET product:bowtie42 $.onsale true
JSON.SET product:bowtie42 $.price 9.99
JSON.DEL product:bowtie42 $.colors
```

**Use cases:** product catalogs, nested configs, API response cache where you need one field without downloading the blob.

**Nuance:** hashes win for flat records and `HINCRBY`. JSON wins for nested objects and arrays. Do not double-store the same document as string + JSON.

---

## Streams, Geo, Bitmaps, Time Series, Vectors

| Type | What it is | Typical use |
|------|------------|-------------|
| **Streams** | Append-only log of events with IDs and field maps. Consumer groups. | Clickstream, “what the user did,” event bus, durable queue better than lists for many consumers |
| **Geospatial** | Named points with longitude / latitude (implemented as a sorted set) | “Stores near me,” radius search, geo-fencing |
| **Bitmaps** | Bit operations on a string | Daily active users (bit per user id), feature flags |
| **Bitfields** | Packed integers in a string | Compact counters |
| **Time series** | Timestamped samples, aggregation, retention | Metrics, IoT, stock ticks |
| **Vector search** | Embeddings + k-nearest-neighbor | Semantic cache, RAG, recommendations, chatbots |

**Stream nuance:** lists are a simple queue; streams add IDs, replay, and consumer groups (`XREADGROUP`) so two workers do not take the same message.

**Vector nuance:** same rules as any vector store — one embedding model for write and query, metadata filters for tenants.

---

## Probabilistic Structures

Trade a little accuracy for **speed and RAM**.

| Structure | Job | Mental model |
|-----------|-----|----------------|
| **HyperLogLog** | Count uniques | ~0.81% standard error, ~12 KB even for huge cardinalities. “How many unique IPs today?” not “who were they?” |
| **Bloom filter** | Membership test | Can say **no** for sure. **Yes** means *probably*. “Username is probably taken.” False positives; no false negatives (standard Bloom). |

**Use Bloom** before hitting a slow database (“have we seen this email?”). Do not use it as the source of truth for billing.

---

## Key Expiration

| Kind | Behavior |
|------|----------|
| **Persistent keys** | Default. Stay until deleted or evicted. |
| **Volatile keys** | Have a **TTL (time to live)** and expire. |

```text
SET bowtie:color red
EXPIRE bowtie:color 60          # expire in 60 seconds
TTL bowtie:color                # seconds left; -1 no expiry; -2 key gone
EXPIREAT bowtie:pattern 4481067600
EXPIRETIME bowtie:pattern
SET session:abc 1 EX 1800       # set + TTL in one command
```

**Use cases**

- **Cache:** miss → load from DB → `SET` with TTL. Stale data dies on its own.
- **Sessions:** TTL = idle timeout; refresh TTL on activity so active users stay, idle ones vanish.

**Nuance:** expiry is not a backup strategy. Expired keys are gone. `TTL -2` means missing, not “expired but still readable.” Combining TTL with `allkeys-lru` eviction is how caches stay inside RAM.

---

## Persistence (RDB vs AOF)

| | **RDB (Redis Database snapshot)** | **AOF (Append Only File)** |
|--|-----------------------------------|----------------------------|
| How | Point-in-time dump | Log every write |
| Speed / CPU | Fast, lighter | Heavier |
| Durability | Lose everything since last snapshot | Can recover to near the crash (`everysec` is the usual compromise) |
| Restore | Import/replace dataset | Replay the log |

**Snapshot (RDB):** good for backups and cold starts. Not enough alone if losing a few minutes of writes is unacceptable.

**AOF:** more durable, more disk and CPU. `appendfsync everysec` is the common Cloud setting vs every write (slow) vs no fsync (risky).

You can use **both**. Cloud also offers **remote backup** to object storage.

---

## Eviction Policies

When RAM is full, Redis must reject writes or drop keys.

| Policy | Drops |
|--------|--------|
| `volatile-lru` | Keys **with TTL**, **least recently used** |
| `allkeys-lru` | Any key, least recently used |
| `volatile-lfu` / `allkeys-lfu` | Least **frequently** used |
| `volatile-ttl` | Soonest-to-expire among keys with TTL |
| `noeviction` | Writes fail when full |

**Cache:** `allkeys-lru` (or LFU) is typical. **Primary store:** `noeviction` plus alerts on memory, or you will silently lose data.

---

## Common Use Cases

| Use case | Why Redis |
|----------|-----------|
| **Enterprise cache** | Sit in front of a slow database; sub-millisecond reads at scale. TTL + LRU. |
| **Search and query** | Secondary indexes on hashes/JSON: full text, numeric filters, geo. |
| **Session management** | Shared, fast session across many app servers. TTL = logout/idle. |
| **Vector search** | Unstructured embeddings for semantic cache, recs, bots. |
| **Leaderboards** | Sorted sets, live ranks. |
| **Rate limiting** | `INCR` + TTL per user/IP window. |
| **Distributed lock** | `SET key token NX EX seconds` (use a known library; naive locks are easy to get wrong). |
| **Pub/Sub** | Live notifications (not durable). Use streams if you must not lose messages. |

---

## Redis Cloud Operator

Redis Cloud is **managed**: high availability, security features, and operations (backups, upgrades) are part of the product.

**Emails / access**

- **Team and API:** invite users (name, email, role).
- **Alert emails:** dataset size, latency, throughput thresholds.
- **Billing emails:** spend thresholds.
- **Operational emails:** maintenance windows.

**Roles (course map)**

| Track | Topics |
|-------|--------|
| Admin | Architecture, subscription admin, database admin, security, network |
| DevOps | Monitoring, automation |
| Developer | Data model, types and commands |

---

## Essentials vs Pro

| | **Essentials** | **Pro** |
|--|----------------|---------|
| Infra | **Shared** | **Dedicated** virtual private cloud |
| Size | ~250 MB–12 GB | Up to tens of TB (priced by size and throughput) |
| Databases per subscription | 1 | Many / effectively unlimited |
| Connections | Up to ~10K | Very high / unlimited class |
| Endpoint | Public only (shared infra) | Public **and** private |
| Active-Active (multi-region) | No | Yes |
| Auto Tiering | Check current plan matrix (often limited vs Pro) | Yes |
| Cloud API / Terraform | Limited | Full admin API |
| Throughput pricing | Simpler / fixed-ish | Priced around ops/sec and memory |

**Essentials:** low throughput, learning, small apps.  
**Pro:** production scale, private networking, many databases, Active-Active, Auto Tiering.

**Auto Tiering:** warm data on SSD/flash, hot data in RAM. Lowers RAM cost for large working sets that are not all equally hot. Available on higher-end plans (confirm on the current SKU).

**Query performance factor:** Pro option to add CPU/throughput headroom for query/search.

**VPC CIDR:** on Pro you pick a CIDR that **must not overlap** the application virtual network.

**Endpoints:** public = easy, internet. Private = only via peering / private connect. Use private in production.

---

## Durability and Replication Settings

**High availability**

| Setting | Meaning |
|---------|---------|
| None | No replica. Node/shard death can lose the database. |
| Single zone | Replica in the same region/zone layout (check UI: often replica on another node, same AZ or not depending on product). |
| Multi zone | Replica in another **availability zone**. Survives one AZ failing. |

**Memory vs replication:** advertised size is often **split** with the replica. Example: 2.5 GB plan **with** replication ≈ **1.25 GB** of data, because the copy uses the other half. Always read the “dataset size” vs “total RAM” line in the UI.

**Active-Active:** one logical database **geo-replicated** across regions. Writes in several places, conflict-free replicated data types, very high availability (four nines class). Use for global users and region failure — not for a tiny cache.

**Active-Passive / Replica Of:** source database streams to a target. After first sync, the target follows. Used for migration and DR. Configuring it can **wipe the target**. Can point at an external Redis or another database in the same account.

---

## Architecture: Shard, Database, Node, Cluster

### Shard

A **standalone Redis process** on the operating system.

- Single-threaded command execution (classic model)
- Holds a slice of keys
- Rough Cloud teaching numbers: on the order of **25 GB** and **~25,000 ops/sec** per shard (planning numbers, not a law of physics)

Scale **out** by adding shards (more keys / more ops). Scale **up** is limited; one process will not use 64 cores for commands.

### Database (Redis Cloud / Software meaning)

The **named database you create**: the full dataset, possibly spread across **many shards**.

This is **not** open-source numbered databases (`SELECT 0`, `SELECT 1`) inside one process. Those numbered slots live **inside a single shard**. A Cloud database is the product you connect to, and it can sit on many shards.

**Multi-tenant:** many databases can share the same nodes so machines stay full and **total cost of ownership** stays lower.

### Node

A server, virtual machine, or pod running Redis Software. One node runs **many shards**.

**Two layers on a node**

| Layer | Pieces |
|-------|--------|
| Management | **DMC** (data management / zero-latency **proxy**) between clients and shards; **cluster manager**; REST API |
| Data | The Redis shards (this clustering story is Redis Software / Cloud, not a single Community process) |

### Cluster

A **collection of nodes** that pool RAM, CPU, and network. Hosts many databases (multi-tenancy).

**Production:** at least **three nodes** so a node loss does not kill quorum and all copies of a shard.

---

## High Availability and Scaling

**Shard roles**

- **Master (primary):** takes writes for its key slot
- **Replica:** copy for high availability

A database can be configured for **scale** (many masters), **high availability** (replica per master), or **both**.

**Cluster manager jobs**

| Job | What it decides |
|-----|-----------------|
| Provisioning | Where to place new shards |
| Migration | Move shards when a node needs CPU, RAM, or network |
| Monitoring | Databases, endpoints, stats across nodes |
| Re-sharding | Split keys onto more shards |
| Re-balancing | Move shards to nodes with spare capacity |
| Deprovisioning | Delete a database and free the cluster |

**Scale vs HA in one line:** more **master** shards = more throughput and more data. **Replicas** = survive a shard/node/AZ loss, at the cost of RAM.

---

## Proxy Policies

Clients hit a **database endpoint**. The **DMC proxy** forwards to the right master shard. By default **one proxy** owns that endpoint. The proxy is a common place **anti-patterns** show up (too many connections, too-large keys, `KEYS *`).

| Policy | Behavior | When |
|--------|----------|------|
| **Standard** | One proxy → all master shards | Default. Enough for most databases. |
| **Multi-proxy** | Several proxies | High connection / network scale. Extra hops can **add latency and cost**. A database **provisioned** above ~250K ops/sec may get multi-proxy even if real traffic is lower — **do not over-provision**. Multi-AZ + multi-proxy means more cross-AZ traffic (bill + latency). |
| **OSS Cluster** | Client library is **cluster-aware** (redis-py, Jedis, …) and talks closer to shards | Fewer hops at huge scale. More complicated clients. Not default because few databases need >250K ops/sec. |

---

## Subscriptions

A **subscription** is the billing and cluster wrapper. Databases live inside it.

**When to create another Pro subscription**

- Separate **dev / QA / prod**
- Separate **business units**
- Special features: Active-Active, Auto Tiering
- Huge number of databases (avoid packing a cluster until it hurts)
- Very high throughput (split load across clusters)

Under the hood, extra Pro subscriptions ≈ extra clusters, which isolates blast radius.

**Remote backup schedule**

- Essentials: typically every **24 hours**
- Pro: **1–24 hours**, optional clock time

**Backup destinations:** Amazon S3, Google Cloud Storage, Azure Blob, FTP.

---

## Backup and Migration

Two practical paths:

### 1) RDB export / import (point in time)

1. Remote backup: bucket already created; a **service principal** (or equivalent) with access.
2. Paste the destination (for Google Cloud, the `gs://` style URI from the bucket UI).
3. **Backup now**.
4. **Import dataset** on the target: this **wipes the current database**. Grant the identity **read and write** on the bucket.

Good for: copy, seed, classic backup. Bad for: zero-downtime cutover with ongoing writes.

### 2) Active-Passive / Replica Of (ongoing sync)

Initial copy, then the target **follows** the source. Use another Cloud database or an external Redis. Same-account source is the simple path.

Good for: migration with a short cutover. Remember: setup can **empty the target** first.

---

## Security

**Never** put personally identifiable information or production secrets in slides, tickets, or this notes file.

### Console

- Roles and permissions on users
- **MFA (multi-factor authentication)**
- Federation: **SAML** to Azure AD / Entra, Okta, Auth0, or **LDAP**
- SAML **Audience** / location fields must match the identity provider

### Database

- **RBAC (role-based access control)** via **ACL (access control list)** users and rules. ACL is **not** an email distribution list; it is “which keys and commands this user may use.”
- **Disable the `default` user** once a real user exists.
- **CIDR allow list:** only these source IPs may connect.
- **TLS:** encrypt in transit; optional **client certificates**.

### Public vs private endpoint

- **Essentials:** public only (shared infrastructure).
- **Private:** more secure; needs **VPC peering** or private connect. Prefer private for production.

---

## Networking

**VPC peering** (app network ↔ Redis network)

1. Peer with VPC IDs and **CIDR** ranges.
2. Accept on the application cloud account.
3. Add a **route** on the app side for the Redis CIDR.

**Drawbacks of peering:** peer count limits, **overlapping CIDRs** fail, **lateral movement** (peering can expose more than Redis if routes are wide). Keep routes tight.

**Better private patterns**

- **Google Cloud Private Service Connect**
- **AWS Transit Gateway** / PrivateLink-style private endpoints

These give a **private endpoint** without a full mesh of classic peers.

Pick Redis **CIDR ≠ app CIDR**.

---

## Monitoring

**In-console alerts (examples)**

- Dataset size over X%
- Latency higher than
- Replica unable to sync / sync lag higher than
- Throughput higher than / lower than (the “lower than” catch is a dead or unused database)

**Prometheus + Grafana**

- Redis exports metrics on port **8070**
- Point Prometheus at the **private** endpoint (`job` scrape config)
- Needs private network access (peering / PSC)
- Grafana: add Prometheus as a data source

Watch: memory, evicted keys, connected clients, ops/sec, hit rate, replica lag.

---

## Automation

| Tool | Role |
|------|------|
| **Redis Cloud API** | Subscriptions, databases, ACLs, account, users, roles. Account API key + user key. Optional CIDR allow list **on the key**. Long jobs return a **task ID** — poll status. |
| **Terraform** | Infrastructure as code: `terraform init`, `plan`, `apply`. |
| **Pulumi** | Same idea; write infrastructure in a general-purpose language (`pulumi up`). Built on similar providers. |

Treat databases like any other production resource: code review, least privilege API keys, no secrets in git.

---

## Quick command cheatsheet

```text
# strings
SET k v     GET k     UNLINK k     INCR k

# lists
LPUSH k a   RPOP k    LRANGE k 0 -1    LLEN k

# sets
SADD k a    SMEMBERS k    SCARD k    SINTER k1 k2

# hashes
HSET k f v  HGET k f  HGETALL k  HINCRBY k f 1

# sorted sets
ZADD k score member    ZRANGE k 0 -1 WITHSCORES    ZRANK k member

# expire
SET k v EX 60    TTL k    EXPIRE k 60

# json
JSON.SET k $ '{...}'    JSON.GET k $.field
```

```text
cache miss → GET → empty → load DB → SET … EX ttl
queue      → LPUSH / BRPOP   or   streams + consumer group
leaderboard → ZADD / ZREVRANGE
session    → HASH or JSON + EXPIRE
unique count → HyperLogLog or SET (if you need the names)
```
