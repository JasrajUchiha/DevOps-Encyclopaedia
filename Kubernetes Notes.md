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
