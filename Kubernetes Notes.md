# Kubernetes Notes

Kubernetes coordinates a highly available cluster of computers that are connected to work as a single unit. It automates the distribution and scheduling of application containers across a cluster in a more efficient way.

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

> **Hack:** End users can also use the Kubernetes API directly to interact with the cluster.

---

## Dashboard

By default, the dashboard is only accessible from within the internal Kubernetes virtual network. The `dashboard` command creates a temporary proxy to make the dashboard accessible from outside the Kubernetes virtual network.

To stop the proxy, press **Ctrl+C** to exit the process. After the command exits, the dashboard remains running in the Kubernetes cluster. You can run the `dashboard` command again to create another proxy to access the dashboard.

---

## Pods & Deployments

A **Kubernetes Pod** is a group of one or more containers, tied together for the purposes of administration and networking. The Pod in this tutorial has only one container.

A **Kubernetes Deployment** checks on the health of your Pod and restarts the Pod's container if it terminates. Deployments are the recommended way to manage the creation and scaling of Pods.

> **Important:** The cluster itself has a manifest too! View it using the config.

Imperative:
kubectl create deployment my-deployment --image=nginx:stable -n my-namespace

Multi Container Pods:

in a pod you can have more than 1 containers.
Types of containers:
Init container:
idecar/helper container

---

## Services

A Kubernetes **Service** assigns a constant virtual IP address and DNS name (via CoreDNS) to a set of pods. Because pods are ephemeral and constantly change IP addresses when they restart or scale, a Service acts as a reliable intermediary for internal and external communication.

### Service Types

| Type | Description |
|------|-------------|
| **ClusterIP** | Exposes the service on a cluster-internal IP (default) |
| **NodePort** | Exposes the service on each node's IP at a static port |
| **ExternalName** | Maps the service to an external DNS name |
| **LoadBalancer** | Exposes the service externally using a cloud provider's load balancer |

NodePort vs ClusterIP:
ClusterIP is the default internal Kubernetes service, providing a stable, internal IP address for pod-to-pod communication within the cluster. NodePort builds directly on ClusterIP by opening a specific, static port on every worker node, allowing external traffic (outside the cluster) to access the application.
NodePort exposes your service on an allocated port (typically 30000-32767) on every node's IP address. When you define a NodePort, Kubernetes automatically provisions an internal ClusterIP under the hood. It is generally not recommended for production setups because managing direct node IP and port combinations can be risky and inefficient.

---

A LoadBalancer Service is merely a service POINTING to a loadbalancer. Which means you need to have a LoadBalancer configured for the service to get assigned an IP. When running in a Kind cluster etc, it defaults to a NodePort service.

To define a service in an Imperative way and create a svc without a yaml, you can use:
kubectl expose deployment my-deployment --port=80 --target-port=9376

---


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
| `targetPort` | Port of the application to route to |
| `port` | Port on which the service is exposed — clients use this when they don't know the application IP (which often changes) |

### Named Port References

Port definitions in Pods have names, and you can reference these names in the `targetPort` attribute of a Service:

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
This works even if there is a mixture of Pods in the Service using a single configured name, with the same network protocol available via different port numbers. This offers a lot of flexibility for deploying and evolving your Services. For example, you can change the port numbers that Pods expose in the next version of your backend software, without breaking clients.


Namespaces:
Created for separating deployments logically in different namespaces. Can have different RBAC for each namespace. If not specified, everything is deployed to the 'default' namespace.

all kubernetes control plane components are created in the kube-system namespace. coredns, etcd, kube-apiserver, kube-controller, kube-proxy, kube-scheduler etc.

If you exec inside a pod, you can access other pods on the cluster in other namespaces using their IP without having any service at all.

If you are exposing a deploymetn using a svc internally. You can reach pods in a deployment in another namespace using the fqdn of the service. e.g if your service is called my-service, you can reach this service from within another pod ofc using its IP but also using 
my-service.namespace-of-my-service.svc.cluster.local

if the two deployments are in the same namespace, they can be reached using the hostname as well as the deployment name. 
hostname = my-service-name, fqdn = my-service-name.namespace-of-my-service.svc.cluster.local

Imperative:
kubectl create ns my-namespace

---

