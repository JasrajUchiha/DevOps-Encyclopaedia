What redis is:
Its a memory first key-value data store

Stores data in memory but can sync with disk for peristent storage
Can store Data Structures like, strings, hashes, lists, json, vectors, etc

Usually used for caching but nowadays for session management, leaderboards for games and vector DBs for AI

Redis Products:
Open Source, Cloud and Redis Software

Redis DB: 
database-MUO8ID3H
username: default
pass: kavy1pG9tEZqFE8a2pOV7l0J2O0y08eR


You can connect to your redis DB on cloud using insight, redis cli or from a programming language like python using redis-py or jedis for java

You can spin up a redis docker container locally and exec into it or connect using redis cli for local development

Keys, values, strings
By default the data type thats stored in a key is a string in redis


SET color red
GET color
UNLINK color - deletes the keys returns number of keys deleted, if no keys are deleted, it returns 0

Keyspaces: these are like namespaces to group keys together using a set of prefixes

Keyspaces are mainly used for making sense out of UIDs. Group UIDs by categories using keyspaces to avoid confusion between if its a product UID or a location UID or a vendor UID

e.g
SET btc:config:paymentserver:hostname payment.paytm.com

e.g
> SET product: 6379: name "Awesome Bowtie"
> SET product:6379:color red
> SET product: 6379: category bowties

You can increment or decrement numbers although theyre strings, you can get substrings or conduct bitwise operations on the strings too. CHECK DOCS


LISTS:
Ordered collection of strings. Ordered means an order is preserved based on when you added the elements. It does not mean sorted.

In redis, head is called the left side of the list and tail is the right side

Commands:
LPUSH: adds element to the head
RPOP: removes element from the tail
RPUSH:
LPOP:

LPUSH outputs number of elements in the list.

LLEN command to get length of list

> LPUSH products:recent:alice BOWTIE42
> LPUSH products:recent:alice BOLOTIE23
> LPUSH products:recent:alice ASCOT13
> LLEN products:recent:alice
> RPOP products:recent:alice -> outputs bowtie42 not ascot13
> RPOP products:recent:alice
> RPOP products:recent:alice
> LRANGE products:recent:bob 0 2
> LRANGE products:recent:bob -3 -1
You can combine positive and negative indices. Do this to get the entire list:
> LRANGE products:recent:bob 0 -1
> LINDEX products:recent:bob 0


it DOES NOT work like a python list. if three elements from the LPUSH, RPOP will remove the element that was added first. its literally pushing to the left of the list and not adding element to the tail of the list.

LRANGE: return a range of elements from a list range is inclusive. uses 0 based and negative indexing to find last element too.

LINDEX: better for finding a single element in the list

Use cases:
When ordering matters: tracking a users previously viewed products
as a Message queue: background task processing
as a stack: breadcrumb trail on a website

Explore more list operations: CHECK DOCS

SETS:
unordered collection of unique strings. this is like a bag data structure

supports set operations like SUNION, SINTER, SDIFF

Use cases: 
Counting and tracking unique things: distinct visitors on a page
Deduplicating data: removing duplicate data from sets.

commands:
> SADD product:views:bowtie42 alice bob chuck dave -> can add multiple elements at once returns number of elements added
> SMEMBERS product:views:bowtie42 -> show all elements of the set
> SCARD product:views:bowtie42 -> cardinality of the set, number of elements in the set
> SREM product:views:bowtie42 chuck dave -> remove members from set


HASHES:
key-value pairs. Confusing? hash keys are called Fields. equivalent to python dict

redis is basically a giant hashset but this one is different.

Use Cases:
• Store session data:
Example: shopping cart user and products in cart natural kv pair

• Store records:
Example: user profile natural kv pairs

• Cache records:
Example: records in a relational database

Learn indexing and searching with redis CHECK DOCS

commands:
> HSET product:bowtie42 name "Awesome Bowtie"
> HSET product:bowtie42 sku BOWTIE42 name "Awesome Bowtie" color red description "This awesome bowtie is the same color of red as the Redis logo." quantity 23
> HGET product:bowtie42 name
> HGETALL product:bowtie42

SORTED SETS:
a kind of mixture of lists and sets.
Elements are unordered as in the sets but each element carries a score like a priority with minimum score being the first element (rank 0) in the list.
it can list elements by rank (index equivalent) or by score(finding elements between a score range and not an index range)

Use cases:
• Leaderboards: Easily rank and keep track of the scores in real-time
• Recommendation engines: Intersect scores for different customers for related products

Commands:
> ZADD product:rank 4.5 BOWTIE42
> ZADD product:rank 4.8 BOLOTIE23 3.2 ASCOT13 4.9 BONDTIE007 -> this is a variadic command too (can pass multiple args)
> ZSCORE product:rank BOWTIE42
> ZRANK product:rank BOWTIE42
Use ZRANGE to get all of the products by rank with scores:
> ZRANGE product:rank 0 -1 WITHSCORES -> will return all elements as well as their scores
Use ZRANGE to get a range of products by score—in this case all products that are 4 stars or above:
> ZRANGE product:rank 4 5  BYSCORE WITHSCORES -> returns elements having scores from 4-5 inclusive ranges

JSON:
store json objects without serializing it as a string.
Indexing and searching still allowed. CHECK DOCS

Commands:
> JSON.SET product:bowtie42 $ '{ "sku": "BOWTIE42", "name": "Awesome Bowtie", "colors": [ "red", "green", "blue" ], "description": "This awesome bowtie is awesome.", "quantity": 23, "onsale": false }' -> product:bowtie is the key of the json document and the rest is the actual doc
> JSON.GET product:bowtie42
> JSON.GET product:bowtie42 $.quantity -> query quantity field from json
> JSON.GET product:bowtie42 $.* -> Get all the values in the root-level fields using a JSONPath with a wildcard.
> JSON.SET product:bowtie42 $.onsale true -> update values
> JSON.SET product:bowtie42 $.price 9.99 -> add values
> JSON.DEL product:bowtie42 $.colors -> remove fields

Probabilistic Data structures: A data structure that sacrifices accuracy to gain improvements in speed and storage

1) Hyperloglog: counts unlimited number of unique items with a standard error of 0.81% while only using only 12kb memory CHECK DOCS

2) Bloom filter: A fast and space-efficient data structure that checks a set for membership

e.g username is probably taken instead of username is definitely taken.

3) Streams
An ordered data structure recording a series of chronological events and their associated data
e.g to find what a user did on the website

4) Geospatial index: A searchable collection of named locations storing longitude and latitude:

literally places and their lat and long values
set but instead of score, adds lat and long

5) bitmaps

6) bitfields:

7) timeseries:

8) vector search: 

Key Expiration:
two types of keys:
persistent keys and volatile keys:
persistent keys are keys that stay in the db. this is the default key behaviour in redis.
volatile keys are keys that have a TTL and are automatically removed.

Use cases for volatile keys:
Caching: Query for data, if not found, add it with TTL. Stale data naturally expires.

Session Management: Store session with a TTL and update when session is refreshed. Inactive sessions are removed and active are served FAST.

Commands:
> SET bowtie:color red
> EXPIRE bowtie:color 60 -> expire in 60 seconds\
> TTL bowtie:color -> check TTL of key. returns -1 if no expiry, -2 if already expired
> EXPIREAT bowtie:pattern 4481067600 -> expire at this time (unix time in seconds)
> EXPIRETIME bowtie:pattern -> to query expiry time that you set


Redis Use Cases:
Enterprise Caching: With Redis caching, data stored in slower databases can achieve sub-millisecond pertormance, at scale

Search and Query: can be executed against hashes and JSON to enable complex query requirements such as; multi-factor search and geo-search

Session Management: uses distributed data to provide faster access to the users' stored session

Vector Search: allows you to store unstructured data for use in semantic caching, recommendation engines, chat bots, and more

Redis Cloud Operator:
Redis Cloud is Fully managed, highly available, secure and fast

Team and API: Access Management to add users using first and last names along with their emails and the role they will need

Alert emails: when your DB crosses alert thresholds
Billing: for billing thresholds
Operational emails: for operational activities like maintenance breaks etc

Setup an essentials DB:
Its created on shared infra vs Pro which is created on dedicated infra for you.

Durability Settings: 
High availability settings value set to 
None: no replication of data.
Single Zone: replicated in another availability zone.
Multi Zone:

Data persistence: snapshot every 6 hrs 1 hr every 1 second
Size of DB divided by replication settings is the data you can store. e.g if you take the 2.5 gb plan but replication is yes, you can only store 1.25 gb data.

Setup a PRO DB:
Has extra features like Active Active Multi Region replication:
Its a DB thats geo replicated around the world. Low latency and 4 nines

Auto Tiering: Storage engine for redis that puts Warm data in to SSDs and Flash Drives instead of the RAM that stores HOT data enabling orgs to save costs and simplify management. This is available on Essential plan too

Can manually secret availability zones.

Select CIDR manually for VPC settings thats other than your app CIDR range. Also a feature only in Pro

Query Performance factor option to boost performance of queries

DB has a public endpoint and a private endpoint

Optimizing redis cloud for scalability:
Increase throughput and ops per second.

Optimize for Durability
1) Snapshot vs Append only file: 
Snapshot
• Fast
• Not Resource Intensive
• Less Durable - Recover to point of Snapshot
AOF (Append Only File)
• Less Fast
• More Resource Intensive
• More Durable - Recover to state at outage

2) Data eviction policy
volatile-lru: remove keys that have ttl that are least recently used
allkeys-lru

3) remote backup:
externalizes the data to back it up

4) Active-Passive Redis:
source db and mirror db.
Wipes source data when configured

Redis cloud security and monitoring:
Security:
Diff between public and private endpoint:
essentials is only public since shared infra not dedicated.
Private is more secure, public is easier to use.
Private needs VPC peering.

1) Default User: you can deactivate this user after creating new users from data access section

2) CIDR Allow List: Limit IP addresses that can reach the DB

3) TLS: enables encryption when you connect to the DB and authenticate using a client cert to connect.

Monitoring: 
Alerts: 
Data set size has reached what %
latency is higher than
replica of db unable to sync with source
repliuca of sync lag is higher than
throughput is higher than
throughput is lower than

Explore Redis Insight:
flushdb command to empty db

Migrate Data in Redis Cloud:
2 ways:
RDB (Redis Database) file export and active passive sync

RDB: Using backup restore, represents DB at a point in time.
Remote backup, interval for backup, storage type could be a cloud provider which has a bucket already craeted and service principal that has access to the bucket so that redis can connect to the bucket. Use the gsUtil UI of the GCP bucket and put it in the
Backup Destination. Use backup now to backup

Then Import Dataset: When you import, it will wipe the current contents of the DB. Read and write permission on the SPN in GCP.

Active-Passive/ReplicaOf:
Initialize and sync from source db to target, after initial sync, the target db gets all changes from the source db as time goes on.

You can use an external DB as well. Use current account for source db in same account.

OPERATE REDIS CLOUD: INTERMEDIATE COURSE:
Admin:
Arch Overview
Subscription admin
DB admin
Security
Network 

Devops:
Monitoring
Automation

Developer Roles:
Planning your data model
Redis Data types and usage

Redis Cloud Arch Overview:
Redis under the hood:
1) Redis shard
• A standalone Redis process running on the
operating system
• Single threaded
• Stores a certain amount of Redis keys
• Can hold up to 25 GB of data
• Handle up to 25,000 operations per second

2) Redis database (Redis Cloud / Redis Enterprise meaning)
A Redis database here is your whole pile of data, split across many Redis shards so one pile can be bigger and faster than a single shard.

This is not the numbered databases inside open-source Redis (the ones you pick with SELECT 0, SELECT 1, and so on inside one Redis process). Those numbered slots live inside a single shard. A Redis Cloud database is the named product you create, and it can sit on many shards at once.

Many databases can share the same machines (multi-tenant). Sharing fills the machines better, so you pay for less leftover unused hardware (lower total cost of owning and running it).

3) Redis Node: servers, vms or pods that run redis software. Each node can run multiple shards

4) Redis Cluster: collection of nodes, pools system resources. It can host multiple databases, this is called multi tenancy.

Redis Node:
1) Management Layer:
DMC (Data Management Layer Proxy)/Zero latency proxy: intermediate layer between clients and shards.
cluster manager: activities of cluster
Rest API:

2) Data Later:
Redis Shards many: not included in Redis Community

Prod cluster has three nodes min

Multi tenancy is a great resource saving feature

Types of Shards(for high avail):
master: main shard
replica: just a copy of master for high availablity

A DB can have Scale or High Availability or Both

Two main Components of Redis Cloud for data management:
Cluster manager responsibilities:
Provisioning 
Deciding where shards will be created and placed
Migration
Deciding when and where shards will be moved if more network throughput, memory or
CPU resources are needed
Monitoring
Databases, endpoints, and gathering statistics across all nodes
Re-Sharding
Distributing keys and their values among new shards
Re-Balancing
Move shards to nodes where more resources are available
Deprovisioning
Remove databases and free up cluster resources

DMC Proxy: Frequently target of anti patterns and bad practices
bridge between client and shards. By default a DB endpoint is managed by a single proxy

proxy policies:
1) Standard Policy: one proxy to all master shards only.

2) Multi Proxy Policy: for scale many network hops, can increase latency.
Considerations for multi(best practices):
• Don't over-provision
A DB over 250K ops/sec will be multi-proxy - even if the actual traffic is much lower
Adds latency and cost
• Multi-proxy policy in a multi-AZ (availability zone) DB has additional
networking implications - including costs
Consider if OSS Cluster Proxy might be a better option

3) OSS Cluster: requires redis client library like redis-py or jedis it is configured to be cluster aware. complicated client code. client knows network topology so that hops can be reduced. This is not default because very few dbs require more than 250k ops per second

Redis Cloud Subscription administration:
Two types of subscriptions: Essentials vs PRO

1) Essentials:
Designed for low-throughput workloads
250 MB to 12 GB memory size*
1 database per subscription
Up to 10K concurrent connections
Some features are not supported (e.g.Active-Active and Auto Tiering)

2) Pro:
• Pricing based on throughput
• Up to 50 TB memory size (pricing based on size)
• Unlimited databases per subscription
• Up to unlimited concurrent connections
• Supports admin Cloud API
• Hosted in dedicated VPCs
Use More than 1 pro subscriptions to reduce load on a single redis cluster under the hood.

When to create multiple subscriptions:
Each Deployment env: dev, qa, prod
Separate BUs
Special Requirements: Active Active, Auto Tiering
Large # of DBs: to avoid performance issues
Large scale deployments: high throughputs.

Remote Backup:
Essential DBs are backed up every 24hrs
Pro DBs can be backed up between each 1 to 24 hrs with a specific time too

Supported storage types: 
S3
GcloudStorage
Azure blob
FTP

Security:
Personally identifiable info should never be shared
Your data should never be shared.

Redis cloud console, securing DBs and network considerations

Redis Cloud Console:
1) Assigning apt roles and permissions to users
2) MFA
3) Federate A2 to a 3rd party provider - LDAP, AAD etc

SAML: AAD, OKTA, Auth0 etc
Location is audience in saml provider

DB Security:
RBAC: ACL Access Control List = Distribution List, disable default user when another user is created

Network Security:
CIDR Allow List: 
VPC Peering:
Other Cloud Provider options: Transit gateway aws or Private service connect with gcp

Networking:
VPC Peering to connect app to redis: Peer VPC using IDs and CIDR, then accept connection on the app server cloud, create a routing route in cloud for the Redis VPC CIDR. Drawbacks: max limit of VPC Peers which can be accepted on a VPC. CIDR blocks can overlap creating problems. Lateral Movement Threat (VPC peer opens connectivity between services found in both VPCs which may be unsafe).

GCloud PSC and AWS Transit creates a private endpoint between your VPC and other networks, this is better than old VPCs

Monitoring:
Prometheus(for getting metrics): redis exports metrics on the 8070 port. Promethues scrapes endpoint for metrics. Use a yaml and point to the internal/private endpoint on the 8070 port. You need a VPC Peering to connect to the internal network.
and Grafana for visualization: in grafana, add a prom data source

Automations:
Redis Cloud API, Terraform, Pulumi
API: Subs, DBs, ACLs, Accounts, Users, Roles etc APIs to manage these resources. Use API account key and assign to user. Can input CIDR Allowlist to the individual key too.

You will get a task ID for long running tasks to check the status.

TF is great for Infra as code: TF init, TF plan, TF apply.

Pulumi is based on TF but it allows to create Infra using your favourite language. Pulumi Up commands to create infra