/**
 * AssetLoader.js
 * Wrapper de GLTFLoader + DRACOLoader. Todas as entidades do jogo usam
 * placeholders procedurais; para trocar por modelos reais, coloque os .glb em
 * /assets/models/ e descomente as funções load*GLB() em cada entidade.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/libs/draco/gltf/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);

/**
 * Carrega um .glb e devolve { scene, animations }.
 * Ativa sombras em todas as malhas automaticamente.
 * @param {string} url
 * @returns {Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>}
 */
export async function loadGLB(url) {
  const gltf = await gltfLoader.loadAsync(url);
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return gltf;
}

/**
 * Normaliza escala e pivô de um modelo importado: o comprimento fica igual a
 * `targetSize` no maior eixo, o modelo é centralizado em X/Z e a base fica em y = 0.
 */
export function fitModel(object, targetSize) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const s = targetSize / Math.max(size.x, size.y, size.z);
  object.scale.multiplyScalar(s);
  box.setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  return object;
}

/**
 * Encontra um clip por nome sem diferenciar maiúsculas, aceitando aliases.
 * Exemplo: findClip(gltf.animations, ['Walk', 'walking', 'Armature|Walk'])
 */
export function findClip(clips, names) {
  const lower = names.map((n) => n.toLowerCase());
  return clips.find((c) => lower.some((n) => c.name.toLowerCase().includes(n))) || null;
}
