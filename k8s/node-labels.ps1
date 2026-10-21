# Applies the dedicated placement labels used by the nodeSelectors in k8s/*.yaml.
# Idempotent. The control-plane node (minikube) is intentionally NOT labelled.
$ErrorActionPreference = 'Stop'

kubectl label node minikube-m02 workload-role=application --overwrite
kubectl label node minikube-m03 workload-role=high        --overwrite
kubectl label node minikube-m04 workload-role=medium      --overwrite
kubectl label node minikube-m05 workload-role=low         --overwrite

kubectl get nodes -L workload-role
