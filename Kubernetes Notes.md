# Kubernetes Notes

Kubernetes coordinates a highly available cluster of computers that are connected to work as a single unit. It automates the distribution and scheduling of application containers across a cluster in a more efficient way.

---

## Table of Contents

- [Cluster Architecture](#cluster-architecture)
- [Dashboard](#dashboard)
- [Pods & Deployments](#pods--deployments)
- [Multi-Container Pods](#multi-container-pods)
- [Commands & Arguments](#commands--arguments)
- [Environment Variables](#environment-variables)
- [Services](#services)
- [Namespaces](#namespaces)
- [DaemonSets](#daemonsets)
- [Jobs & CronJobs](#jobs--cronjobs)
- [Static Pods](#static-pods)
- [Manual Scheduling](#manual-scheduling)
- [Labels & Selectors](#labels--selectors)
- [Taints & Tolerations](#taints--tolerations)
- [Node Selection (nodeSelector & nodeAffinity)](#node-selection-nodeselector--nodeaffinity)

---

## Cluster Architecture

A Kubernetes cluster consists of two types of resources:

- **Control Plane** — coordinates the cluster
- **Nodes** — workers that run applications

### Control Plane

The Control Plane coordinates all activities in your cluster, such as:

- Scheduling applications
- Maintaining applications' desired state
- Scaling applications
- Rolling out new updates

### Nodes

A node is a VM or a physical computer that serves as a worker machine in a Kubernetes cluster. Each node has a **Kubelet** — an agent for managing the node and communicating with the Kubernetes control plane. Nodes also need tools for handling container operations, such as **containerd** or **CRI-O**.

> **Production tip:** A cluster handling production traffic should have a minimum of three nodes. If one node goes down, both an etcd member and a control plane instance are lost, and redundancy is compromised. You can mitigate this risk by adding more control plane nodes.

Node-level components (such as the kubelet) communicate with the control plane using the **Kubernetes API**.

> **Hack:** End users can also use the Kubernetes API directly to interact with the cluster (via `kubectl`, client libraries, or REST calls).

---

## Dashboard

By default, the dashboard is only accessible from within the internal Kubernetes virtual network. The `dashboard` command creates a temporary proxy to make the dashboard accessible from outside the Kubernetes virtual network.

To stop the proxy, press **Ctrl+C** to exit the process. After the command exits, the dashboard remains running in the Kubernetes cluster. You can run the `dashboard` command again to create another proxy to access the dashboard.

---

## Pods & Deployments

A **Kubernetes Pod** is a group of one or more containers, tied together for the purposes of administration and networking. Containers in the same Pod share:

- The same network namespace (they can talk to each other via `localhost`)
- The same storage volumes (optional)
- The same lifecycle (they are scheduled and destroyed together)

A **Kubernetes Deployment** is a higher-level controller that manages Pods. It:

- Maintains the desired number of Pod replicas
- Checks Pod health and restarts containers if they crash
- Enables rolling updates and rollbacks

Deployments are the recommended way to manage the creation and scaling of Pods — you rarely create bare Pods directly in production.

> **Important:** The cluster itself has a manifest too. View it with:
>
> ```bash
> kubectl config view
> ```
>
> This shows your kubeconfig — cluster endpoints, credentials, and context — not the in-cluster resources, but how *your machine* connects to the cluster.

### Imperative vs Declarative

| Approach | Description | Example |
|----------|-------------|---------|
| **Imperative** | You tell Kubernetes *what to do* via commands | `kubectl create deployment ...` |
| **Declarative** | You define *desired state* in YAML and apply it | `kubectl apply -f deployment.yaml` |

**Imperative example — create a deployment without YAML:**

```bash
kubectl create deployment my-deployment --image=nginx:stable -n my-namespace
```

> Prefer declarative (YAML + `kubectl apply`) in production — it's version-controllable, repeatable, and easier to review.

---

## Multi-Container Pods

A Pod can run more than one container. All containers in a Pod share the same IP address and can communicate over `localhost`.

### Container Types

| Type | Purpose | Runs When |
|------|---------|-----------|
| **Init container** | Runs setup tasks *before* the main app starts (e.g. wait for a DB, download config, run migrations) | Sequentially, one after another, before any app container starts |
| **Sidecar / helper container** | Runs *alongside* the main app to extend or support it (e.g. log shipping, proxy, monitoring agent) | For the entire lifetime of the Pod, in parallel with the app |
| **App container** | The main application you are deploying | For the entire lifetime of the Pod |

**Init container example — wait for a service before starting the app:**

```yaml
spec:
  initContainers:
    - name: wait-for-db
      image: busybox
      command: ['sh', '-c', 'until nc -z db-service 5432; do sleep 2; done']
  containers:
    - name: my-app
      image: my-app:latest
```

**Sidecar example — a logging agent alongside your app:**

```yaml
spec:
  containers:
    - name: my-app
      image: my-app:latest
    - name: log-shipper
      image: fluentd:latest
      volumeMounts:
        - name: logs
          mountPath: /var/log
```

---

## Commands & Arguments

By default, a container runs whatever command is defined in the container image's `ENTRYPOINT` and `CMD`. You can override these in the Pod/Deployment manifest.

| Field | Maps to Docker | Purpose |
|-------|----------------|---------|
| `command` | `ENTRYPOINT` | The executable to run |
| `args` | `CMD` | Arguments passed to the command |

**Example — override the default nginx command:**

```yaml
spec:
  containers:
    - name: nginx
      image: nginx:stable
      command: ["nginx"]
      args: ["-g", "daemon off;"]
```

> If you only set `args` without `command`, Kubernetes uses the image's default `ENTRYPOINT` and replaces only the `CMD`.

---

## Environment Variables

Environment variables inject configuration into containers at runtime. Define them under `spec.containers[].env` in a Pod or Deployment manifest.

**Direct value:**

```yaml
spec:
  containers:
    - name: my-app
      image: my-app:latest
      env:
        - name: LOG_LEVEL
          value: "debug"
        - name: APP_PORT
          value: "8080"
```

**From a ConfigMap or Secret (preferred for config and sensitive data):**

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: url
  - name: APP_CONFIG
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: settings.json
```

> Use **ConfigMaps** for non-sensitive config and **Secrets** for passwords, tokens, and keys. Never hardcode secrets in manifests.

---

## Services

A Kubernetes **Service** assigns a constant virtual IP address and DNS name (via CoreDNS) to a set of pods. Because pods are ephemeral and constantly change IP addresses when they restart or scale, a Service acts as a reliable intermediary for internal and external communication.

### Service Types

| Type | Description | Use Case |
|------|-------------|----------|
| **ClusterIP** | Exposes the service on a cluster-internal IP (default) | Internal pod-to-pod communication |
| **NodePort** | Opens a static port (30000–32767) on every node's IP | Dev/testing, or when no cloud LB is available |
| **ExternalName** | Maps the service to an external DNS name (CNAME) | Pointing to an external service outside the cluster |
| **LoadBalancer** | Provisions a cloud provider's external load balancer | Production external traffic in cloud environments |

### ClusterIP vs NodePort

**ClusterIP** is the default internal Kubernetes service. It provides a stable, internal virtual IP for pod-to-pod communication *within* the cluster. No external access.

**NodePort** builds on ClusterIP by opening a specific, static port on *every* worker node. External traffic hits `<NodeIP>:<NodePort>` and is forwarded to the Service's ClusterIP, which routes to Pods.

```
External client → NodeIP:30080 → NodePort → ClusterIP → Pod
```

> NodePort is generally **not recommended for production** — managing direct node IP + port combinations is risky, ports are limited (30000–32767), and you lose the benefits of a proper load balancer.

### LoadBalancer

A LoadBalancer Service is a Service that *points to* a cloud load balancer — you need an actual LoadBalancer provisioner (e.g. AWS ELB, GCP LB, MetalLB on bare metal). Kubernetes creates the LB and assigns it an external IP, which routes traffic to the Service's ClusterIP.

> In local clusters (Kind, Minikube), LoadBalancer often falls back to NodePort because no cloud LB exists.

**Imperative example — expose a deployment as a Service without YAML:**

```bash
kubectl expose deployment my-deployment --port=80 --target-port=9376
```

This creates a ClusterIP Service named `my-deployment` that routes port 80 to container port 9376.

### Basic Service Example

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app.kubernetes.io/name: MyApp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 9376
```

This service routes to any pods listening on port **9376** with the `app.kubernetes.io/name: MyApp` label, and is itself listening on port **80**.

| Field | Meaning |
|-------|---------|
| `selector` | Labels used to find which Pods this Service routes to |
| `port` | Port the Service listens on — what clients connect to |
| `targetPort` | Port on the Pod/container to forward traffic to |

### Named Port References

Port definitions in Pods can have names, and you can reference those names in a Service's `targetPort`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-service
spec:
  selector:
    app.kubernetes.io/name: proxy
  ports:
    - name: name-of-service-port
      protocol: TCP
      port: 80
      targetPort: http-web-svc
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
  labels:
    app.kubernetes.io/name: proxy
spec:
  containers:
    - name: nginx
      image: nginx:stable
      ports:
        - containerPort: 80
          name: http-web-svc
```

This works even when Pods in the same Service use different port numbers but share the same port *name* and protocol — useful when evolving backend versions without breaking clients.

---

## Namespaces

Namespaces provide logical separation of resources within a single cluster. Use them to:

- Isolate teams, environments (dev/staging/prod), or applications
- Apply different **RBAC** policies per namespace
- Set resource quotas per namespace

If no namespace is specified, everything is deployed to the **`default`** namespace.

All Kubernetes control plane components live in the **`kube-system`** namespace: CoreDNS, etcd, kube-apiserver, kube-controller-manager, kube-proxy, kube-scheduler, etc.

**Imperative example — create a namespace:**

```bash
kubectl create ns my-namespace
```

### Cross-Namespace Communication

**Pod-to-Pod (no Service needed):** If you exec into a Pod, you can reach other Pods anywhere in the cluster by their Pod IP directly — no Service required.

**Pod-to-Service (recommended):** To reach a Service in another namespace, use the **Fully Qualified Domain Name (FQDN)**:

```
<service-name>.<namespace>.svc.cluster.local
```

**Example:** Service `my-service` in namespace `backend`:

```
my-service.backend.svc.cluster.local
```

**Same namespace — short names work too:**

| Format | Example | When to Use |
|--------|---------|-------------|
| Service name | `my-service` | Same namespace |
| Short DNS | `my-service.backend` | Cross-namespace (within cluster) |
| FQDN | `my-service.backend.svc.cluster.local` | Cross-namespace (always works) |

> DNS resolution inside the cluster is handled by **CoreDNS**. Any Pod can resolve these names automatically.

---

## DaemonSets

A **DaemonSet** is like a ReplicaSet, but instead of running a fixed number of replicas, it ensures **one Pod runs on every (matching) node** in the cluster. When a new node joins, the DaemonSet automatically creates a Pod on it. When a node is removed, those Pods are garbage-collected.

| Controller | Behavior |
|------------|----------|
| **ReplicaSet / Deployment** | Runs N replicas — scheduler picks any suitable nodes |
| **DaemonSet** | Runs exactly 1 Pod *per node* — one copy on every node |

### Common Use Cases

- **Monitoring agents** — e.g. Prometheus node exporter on every node
- **Logging agents** — e.g. Fluentd collecting logs from every node
- **Cluster networking** — CNI plugins run as DaemonSets
- **kube-proxy** — handles Service networking rules on every node

### CNI Plugins (Weave, Flannel, Calico)

These are **Container Network Interface (CNI)** plugins — they provide pod networking in Kubernetes. Each Pod gets its own IP, and Pods on different nodes can communicate. CNI plugins typically run as DaemonSets so every node has the networking agent installed.

| Plugin | Brief |
|--------|-------|
| **Flannel** | Simple overlay network; wraps traffic in UDP/VXLAN. Easy to set up, good for basic clusters |
| **Weave Net** | Overlay network with built-in encryption and DNS. Similar to Flannel with extra features |
| **Calico** | Uses BGP routing instead of heavy overlay; strong network policies for fine-grained firewall rules. Popular in production |

> All three solve the same core problem: *how do Pods on different nodes talk to each other?* They differ in complexity, performance, and policy features.

### DaemonSet Example

YAML structure is similar to a Deployment — `spec.template` defines the Pod, and `spec.selector` matches it:

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd-elasticsearch
  namespace: kube-system
  labels:
    k8s-app: fluentd-logging
spec:
  selector:
    matchLabels:
      name: fluentd-elasticsearch
  template:
    metadata:
      labels:
        name: fluentd-elasticsearch
    spec:
      tolerations:
        # Allow running on control plane nodes (remove if CP should stay pod-free)
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
        - key: node-role.kubernetes.io/master
          operator: Exists
          effect: NoSchedule
      containers:
        - name: fluentd-elasticsearch
          image: quay.io/fluentd_elasticsearch/fluentd:v5.0.1
          resources:
            limits:
              memory: 200Mi
            requests:
              cpu: 100m
              memory: 200Mi
          volumeMounts:
            - name: varlog
              mountPath: /var/log
      terminationGracePeriodSeconds: 30
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
```

> **Tolerations** let DaemonSet Pods run on nodes that normally reject workloads (e.g. control plane nodes with a `NoSchedule` taint). Without tolerations, the DaemonSet would skip tainted nodes.

---

## Jobs & CronJobs

### Jobs

A **Job** creates one or more Pods that run until they **complete successfully** — then stop. Unlike Deployments (which keep Pods running forever), Jobs are for one-off or batch tasks.

| Use Case | Example |
|----------|---------|
| Database migration | Run schema update once |
| Data processing | Batch export/import |
| Backup | Snapshot and upload |

Once all Pods in a Job finish, the Job's status is set to **Complete**. Failed Jobs can be retried based on `backoffLimit`.

### CronJobs

A **CronJob** creates Jobs on a **schedule** — like cron on Linux. Use it for recurring tasks: backups, report generation, cleanup scripts.

**Cron syntax:**

```
┌───────────── minute (0–59)
│ ┌───────────── hour (0–23)
│ │ ┌───────────── day of month (1–31)
│ │ │ ┌───────────── month (1–12)
│ │ │ │ ┌───────────── day of week (0–6, Sun=0)
│ │ │ │ │
* * * * *
```

| Field | Range | Example |
|-------|-------|---------|
| Minute | 0–59 | `0` = at minute 0 |
| Hour | 0–23 | `14` = 2 PM |
| Day of Month | 1–31 | `1` = first of the month |
| Month | 1–12 | `*` = every month |
| Day of Week | 0–6 | `0` = Sunday |

**Every nth interval** — use `*/n` in the field:

```bash
*/18 * * * *    # every 18 minutes
0 */2 * * *     # every 2 hours (at minute 0)
0 0 * * 0       # every Sunday at midnight
```

**CronJob example:**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: db-backup
spec:
  schedule: "0 2 * * *"   # daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: backup-tool:latest
              command: ["/bin/sh", "-c", "pg_dump ..."]
          restartPolicy: OnFailure
```

---

## Static Pods

The **kube-scheduler** is a control plane component responsible for assigning Pods to nodes. But the scheduler itself runs as a Pod — so who schedules *the scheduler*?

**Static Pods** solve this bootstrap problem. They are Pods managed **directly by the kubelet** on a specific node, **not** by the Kubernetes scheduler or any controller (Deployment, DaemonSet, etc.).

```
Manifest file on disk → kubelet reads it → Pod created on that node
(No scheduler, no API server controller involved)
```

### How It Works

1. Place a Pod manifest (YAML/JSON) in a directory the kubelet watches — usually `/etc/kubernetes/manifests`
2. The kubelet detects the file and creates the Pod on **that node only**
3. The kube-apiserver sees the Pod (kubelet reports it) and creates a **mirror Pod** in `kube-system` for visibility — but the kubelet remains the source of truth
4. If you delete the mirror Pod via `kubectl`, the kubelet recreates it from the manifest on disk

Control plane components (kube-apiserver, kube-scheduler, kube-controller-manager, etcd) are typically run as static Pods on control plane nodes.

**Find the watched directory:**

```bash
# On a control plane node — check kubelet config
ps -ef | grep kubelet
# Look for --pod-manifest-path or staticPodPath in the config
```

> **`ps -ef`** lists all running processes in full format. `ps` = process status, `-e` = every process, `-f` = full listing (UID, PID, command, etc.). Use it here to inspect kubelet startup flags and find `--config` or `--pod-manifest-path`.

Common path: `/etc/kubernetes/manifests`

---

## Manual Scheduling

By default, the scheduler picks which node runs a Pod. You can **bypass the scheduler entirely** by setting `nodeName` in the Pod spec:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  nodeName: worker-node-2   # force this Pod onto a specific node
  containers:
    - name: nginx
      image: nginx:stable
```

| Approach | How | Scheduler Involved? |
|----------|-----|---------------------|
| Default | Scheduler picks a node | Yes |
| `nodeName` | You specify the exact node | No — kubelet on that node starts the Pod directly |

> Because the scheduler is bypassed, the Pod is placed even if the scheduler is down. Downside: no automatic rebalancing — if the node is unavailable, the Pod stays unscheduled until that node returns.

**Alternative — `nodeSelector`:** Soft constraint using labels (scheduler still involved, but only picks nodes matching the label):

```yaml
spec:
  nodeSelector:
    disktype: ssd
```

---

## Labels & Selectors

**Labels** are key-value pairs attached to Kubernetes objects (Pods, Nodes, Services, etc.). **Selectors** are queries that filter objects by their labels. Together they are the primary mechanism for grouping and connecting resources.

```
Labels on Pods  ←—— matched by ——→  Selectors on Services/Controllers
```

### Labels

Attach labels in `metadata.labels`:

```yaml
metadata:
  labels:
    app: nginx
    env: production
    tier: frontend
```

- Arbitrary key-value pairs — you define the schema
- An object can have many labels
- Used for organization, filtering, and routing

**Common kubectl label commands:**

```bash
kubectl get pods --show-labels
kubectl get pods -l app=nginx              # filter by label
kubectl get pods -l 'env in (prod,staging)'
kubectl label pod my-pod version=v2        # add/update a label
kubectl label pod my-pod env-              # remove label (trailing -)
```

### Selectors

Selectors tell controllers and Services **which objects they manage or route to**.

**Equality-based** (`matchLabels`) — exact key-value match:

```yaml
spec:
  selector:
    matchLabels:
      app: nginx
      tier: frontend
```

**Set-based** (`matchExpressions`) — richer matching:

```yaml
spec:
  selector:
    matchExpressions:
      - key: env
        operator: In
        values: [production, staging]
      - key: tier
        operator: NotIn
        values: [backend]
```

### Where Selectors Are Used

| Resource | Selector Purpose |
|----------|------------------|
| **Deployment / ReplicaSet** | Finds Pods it should manage (must match Pod template labels) |
| **Service** | Finds Pods to route traffic to (`spec.selector`) |
| **DaemonSet** | Finds Pods it owns on each node |
| **NetworkPolicy** | Filters which Pods a policy applies to |

### Important Rules

1. **Deployment selector must match Pod template labels** — if they diverge, the Deployment won't manage its own Pods
2. **Service selector must match Pod labels** — otherwise the Service has no endpoints and traffic goes nowhere
3. **Labels ≠ Selectors on the same object** — labels describe *what an object is*; selectors describe *what other objects it targets*
4. **Immutable selectors** — on Deployments, the selector cannot be changed after creation (you'd need a new Deployment)

**End-to-end example:**

```yaml
# Deployment creates Pods with labels app=nginx, tier=frontend
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
        tier: frontend
    spec:
      containers:
        - name: nginx
          image: nginx:stable
---
# Service routes to Pods where app=nginx
apiVersion: v1
kind: Service
metadata:
  name: nginx-svc
spec:
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
```

The Deployment's selector (`app: nginx`) matches its Pod labels. The Service's selector (`app: nginx`) matches the same Pods — so traffic flows: **Client → Service → Pod**.

---

## Taints & Tolerations

**Taints** and **tolerations** control which Pods are *allowed* to run on a node. Think of them as the opposite of labels/selectors:

```
Labels/Selectors  →  Pod says "I want nodes like X"     (attraction)
Taints/Tolerations →  Node says "Keep away unless you tolerate me" (repulsion)
```

A **taint** is applied to a **node**. A **toleration** is applied to a **Pod**. A Pod can only schedule on a tainted node if it has a matching toleration.

A taint can tell which kind of pods are allowed to be scheduled on the tainted node, but the pod can be scheduled on other nodes too even if it has a toleration on current tainted pod specified (repulsion).

### Taint Structure

```bash
kubectl taint nodes <node-name> key=value:Effect
```

| Part | Example | Meaning |
|------|---------|---------|
| **key** | `node-role.kubernetes.io/control-plane` | Identifier for the taint |
| **value** | (optional) `true` | Optional value — must match if specified |
| **effect** | `NoSchedule` | What happens to Pods without a toleration |

### Taint Effects

| Effect | Behavior | Existing Pods |
|--------|----------|---------------|
| **NoSchedule** | New Pods without a toleration are **not scheduled** on this node | Unaffected — keep running |
| **PreferNoSchedule** | Scheduler **tries to avoid** this node, but may place Pods if no better option | Unaffected |
| **NoExecute** | New Pods without a toleration are **not scheduled** | Existing Pods **without a toleration are evicted** |

> **NoExecute** is the strictest — it actively kicks off running Pods. Use it for maintenance or decommissioning nodes.

### Toleration Structure

Defined in the Pod spec under `spec.tolerations`:

```yaml
spec:
  tolerations:
    - key: "node-role.kubernetes.io/control-plane"
      operator: "Exists"        # key exists, value ignored
      effect: "NoSchedule"
```

| Field | Options | Meaning |
|-------|---------|---------|
| `key` | any string | Must match the taint key |
| `operator` | `Equal`, `Exists` | `Equal` = key + value must match; `Exists` = key alone is enough |
| `value` | string | Required when `operator: Equal` |
| `effect` | `NoSchedule`, `PreferNoSchedule`, `NoExecute` | Must match the taint effect |
| `tolerationSeconds` | integer | Only for `NoExecute` — how long to wait before evicting (default: immediate) |

**`Equal` vs `Exists` examples:**

```yaml
# Taint on node: dedicated=gpu:NoSchedule
tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "gpu"
    effect: "NoSchedule"

# Taint on node: node-role.kubernetes.io/control-plane:NoSchedule (no value)
tolerations:
  - key: "node-role.kubernetes.io/control-plane"
    operator: "Exists"
    effect: "NoSchedule"
```

### Common Scenarios

| Scenario | Taint | Who Tolerates |
|----------|-------|---------------|
| **Control plane nodes** | `node-role.kubernetes.io/control-plane:NoSchedule` | System DaemonSets (kube-proxy, CNI, etc.) via `Exists` toleration |
| **Dedicated GPU nodes** | `dedicated=gpu:NoSchedule` | Only ML/training Pods with matching toleration |
| **Spot/preemptible instances** | `spot=true:NoSchedule` | Fault-tolerant batch Jobs that can handle sudden eviction |
| **Node maintenance** | `maintenance=true:NoExecute` | Nothing — all non-tolerating Pods get evicted; drain the node |
| **Special hardware** | `hardware=ssd:NoSchedule` | Pods that need SSD-backed storage |

**Taint a node (imperative):**

```bash
kubectl taint nodes worker-1 dedicated=gpu:NoSchedule
kubectl taint nodes worker-1 dedicated=gpu:NoSchedule-   # remove taint (trailing -)
```

**Dedicated GPU node example:**

```yaml
# Node tainted: dedicated=gpu:NoSchedule
apiVersion: v1
kind: Pod
metadata:
  name: ml-training
spec:
  tolerations:
    - key: "dedicated"
      operator: "Equal"
      value: "gpu"
      effect: "NoSchedule"
  containers:
    - name: trainer
      image: ml-trainer:latest
```

> A toleration alone does **not** guarantee the Pod lands on that node — it only *permits* scheduling there. Combine with **nodeSelector** or **nodeAffinity** to actively target specific nodes.

---

## Node Selection (nodeSelector & nodeAffinity)

While taints/tolerations control what is *blocked* from a node, **nodeSelector** and **nodeAffinity** control where a Pod *wants* to run — by matching **labels on nodes**.

Nodes have labels just like Pods:

```bash
kubectl label nodes worker-1 disktype=ssd
kubectl label nodes worker-2 disktype=hdd
kubectl label nodes gpu-node-1 accelerator=nvidia-tesla
kubectl get nodes --show-labels
```

Built-in node labels (automatically set):

| Label | Example Value |
|-------|---------------|
| `kubernetes.io/hostname` | `worker-1` |
| `node.kubernetes.io/instance-type` | `m5.large` (cloud) |
| `topology.kubernetes.io/zone` | `us-east-1a` |
| `node-role.kubernetes.io/control-plane` | (exists on CP nodes) |

### nodeSelector

The simplest form — hard requirement. Pod **only** schedules on nodes where **all** specified labels match. If no node matches, the Pod stays **Pending**.

```yaml
spec:
  nodeSelector:
    disktype: ssd
    zone: us-east-1a
```

> Limited to exact `key: value` matches. No "prefer" logic, no operators like `In`/`NotIn`. For anything beyond simple matching, use nodeAffinity.

### nodeAffinity

A richer, more expressive version of nodeSelector. Two types:

| Type | Field | Behavior |
|------|-------|----------|
| **Required** | `requiredDuringSchedulingIgnoredDuringExecution` | Hard rule — must match or Pod stays Pending |
| **Preferred** | `preferredDuringSchedulingIgnoredDuringExecution` | Soft rule — scheduler tries to match, but schedules elsewhere if needed |

**Required nodeAffinity — must run on SSD nodes in zone A:**

```yaml
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: disktype
                operator: In
                values: [ssd]
              - key: topology.kubernetes.io/zone
                operator: In
                values: [us-east-1a]
```

**Preferred nodeAffinity — prefer GPU nodes, but allow others:**

```yaml
spec:
  affinity:
    nodeAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          preference:
            matchExpressions:
              - key: accelerator
                operator: In
                values: [nvidia-tesla]
```

**Affinity operators:**

| Operator | Meaning |
|----------|---------|
| `In` | Label value is in the list |
| `NotIn` | Label value is not in the list |
| `Exists` | Label key exists (any value) |
| `DoesNotExist` | Label key does not exist |
| `Gt` / `Lt` | Greater/less than (for numeric values) |

> **`IgnoredDuringExecution`** means if node labels change *after* the Pod is scheduled, the Pod is **not evicted** — affinity is only checked at scheduling time.

### Combined Example — GPU Workload

A complete Pod targeting GPU nodes that are tainted for dedicated use:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-training
spec:
  tolerations:
    - key: "dedicated"
      operator: "Equal"
      value: "gpu"
      effect: "NoSchedule"
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: accelerator
                operator: In
                values: [nvidia-tesla]
  containers:
    - name: trainer
      image: ml-trainer:latest
```

1. **Toleration** — allowed onto tainted GPU nodes
2. **nodeAffinity** — actively targets nodes with `accelerator=nvidia-tesla`

### Comparison — All Scheduling Mechanisms

| Mechanism | Applied On | Direction | Flexibility | Scheduler Involved? |
|-----------|-----------|-----------|-------------|---------------------|
| **nodeName** | Pod spec | Pod → exact node | None — hard pin | No |
| **nodeSelector** | Pod spec | Pod → nodes with labels | Basic — exact match only | Yes |
| **nodeAffinity** | Pod spec | Pod → nodes with labels | High — required + preferred, operators | Yes |
| **Taints** | Node | Node → repels Pods | 3 effects | N/A (node-side) |
| **Tolerations** | Pod spec | Pod → permits tainted nodes | Must match taint key/effect | Yes |

### Taints/Tolerations vs nodeSelector/nodeAffinity

| | Taints & Tolerations | nodeSelector & nodeAffinity |
|--|---------------------|----------------------------|
| **Perspective** | Node-centric — "who can come here?" | Pod-centric — "where do I want to go?" |
| **Analogy** | Bouncer at a VIP room | Guest requesting a specific table |
| **Default behavior** | All Pods blocked from tainted node | Pod can run anywhere unless constrained |
| **Best for** | Protecting special nodes (CP, GPU, maintenance) | Targeting specific hardware/zones/topology |
| **Used together?** | Yes — commonly combined (see GPU example above) | Yes |

**Decision guide:**

```
Need to KEEP Pods OFF a node?        → Taint the node
Need to ALLOW specific Pods ON it?   → Add toleration to those Pods
Need to ATTRACT Pods TO a node?      → Label the node + use nodeSelector/nodeAffinity
Need to PIN a Pod to one node?       → Use nodeName (bypasses scheduler)
```