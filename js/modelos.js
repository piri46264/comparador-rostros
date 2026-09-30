/* Carga de modelos de face-api incrustados en modelos/*.js (sin fetch, compatible con file://). */
(function () {
  'use strict';

  const REDES = {
    ssd_mobilenetv1_model: 'ssdMobilenetv1',
    face_landmark_68_model: 'faceLandmark68Net',
    face_recognition_model: 'faceRecognitionNet',
    age_gender_model: 'ageGenderNet',
    face_expression_model: 'faceExpressionNet',
  };

  function base64ABuffer(b64) {
    const binario = atob(b64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes.buffer;
  }

  async function prepararBackend() {
    const tf = faceapi.tf;
    for (const backend of ['webgl', 'cpu']) {
      try {
        if (await tf.setBackend(backend)) {
          await tf.ready();
          return tf.getBackend();
        }
      } catch (e) { /* se intenta el siguiente */ }
    }
    throw new Error('No se pudo inicializar TensorFlow.js en este navegador.');
  }

  async function cargarModelos(alProgresar) {
    if (typeof faceapi === 'undefined') throw new Error('No se cargó la librería face-api.js (vendor/face-api.js).');
    const backend = await prepararBackend();
    const nombres = Object.keys(REDES);
    for (let i = 0; i < nombres.length; i++) {
      const nombre = nombres[i];
      const modelo = window.MODELOS_FACIALES && window.MODELOS_FACIALES[nombre];
      if (!modelo) throw new Error(`Falta el archivo modelos/${nombre}.js`);
      const mapa = faceapi.tf.io.decodeWeights(base64ABuffer(modelo.datos), modelo.pesos);
      await faceapi.nets[REDES[nombre]].loadFromWeightMap(mapa);
      modelo.datos = null; // liberar memoria del texto base64
      if (alProgresar) alProgresar((i + 1) / nombres.length, nombre);
      await new Promise((r) => setTimeout(r, 0));
    }
    return backend;
  }

  window.CargadorModelos = { cargarModelos };
})();
