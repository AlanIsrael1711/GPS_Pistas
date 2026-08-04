(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.RouteEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    class MinHeap {
        constructor() {
            this.data = [];
        }

        push(value, score, cost) {
            this.data.push({ value, score, cost });
            this._up(this.data.length - 1);
        }

        pop() {
            if (this.data.length === 0) return null;
            const top = this.data[0];
            const bottom = this.data.pop();
            if (this.data.length > 0) {
                this.data[0] = bottom;
                this._down(0);
            }
            return top;
        }

        _up(index) {
            while (index > 0) {
                const parent = (index - 1) >> 1;
                if (this.data[parent].score <= this.data[index].score) break;
                [this.data[parent], this.data[index]] = [this.data[index], this.data[parent]];
                index = parent;
            }
        }

        _down(index) {
            const length = this.data.length;
            while ((index << 1) + 1 < length) {
                const left = (index << 1) + 1;
                const right = left + 1;
                const smallest = right < length && this.data[right].score < this.data[left].score
                    ? right
                    : left;
                if (this.data[index].score <= this.data[smallest].score) break;
                [this.data[index], this.data[smallest]] = [this.data[smallest], this.data[index]];
                index = smallest;
            }
        }

        get length() {
            return this.data.length;
        }
    }

    function coordenadasNodo(id) {
        const [lng, lat] = String(id).split(',').map(Number);
        return { lat, lng };
    }

    function distanciaHaversine(idA, idB) {
        const a = coordenadasNodo(idA);
        const b = coordenadasNodo(idB);
        const rad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * rad;
        const dLng = (b.lng - a.lng) * rad;
        const lat1 = a.lat * rad;
        const lat2 = b.lat * rad;
        const senoLat = Math.sin(dLat / 2);
        const senoLng = Math.sin(dLng / 2);
        const h = senoLat * senoLat + Math.cos(lat1) * Math.cos(lat2) * senoLng * senoLng;
        return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function claveArista(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function reconstruirCamino(parents, parentEdges, startId, endId, costoTotal) {
        const ids = [];
        const edges = [];
        let current = endId;

        while (current) {
            ids.push(current);
            if (current === startId) break;
            const edge = parentEdges.get(current);
            if (!edge) return null;
            edges.push(edge);
            current = parents.get(current);
        }

        ids.reverse();
        edges.reverse();
        return { ids, edges, costoTotal };
    }

    function buscarRuta(grafo, startId, endId, opciones = {}) {
        if (!grafo || !grafo.has(startId) || !grafo.has(endId)) return null;
        if (startId === endId) return { ids: [startId], edges: [], costoTotal: 0 };

        const heuristic = opciones.heuristic || distanciaHaversine;
        const edgeAllowed = opciones.edgeAllowed || (() => true);
        const edgeCost = opciones.edgeCost || (edge => edge.cost);
        const open = new MinHeap();
        const gScores = new Map([[startId, 0]]);
        const parents = new Map();
        const parentEdges = new Map();

        open.push(startId, heuristic(startId, endId), 0);

        while (open.length > 0) {
            const current = open.pop();
            if (current.cost > (gScores.get(current.value) ?? Infinity)) continue;
            if (current.value === endId) {
                return reconstruirCamino(parents, parentEdges, startId, endId, current.cost);
            }

            for (const edge of grafo.get(current.value) || []) {
                if (!edgeAllowed(edge, current.value)) continue;
                const stepCost = Number(edgeCost(edge, current.value));
                if (!Number.isFinite(stepCost) || stepCost < 0) continue;

                const candidate = current.cost + stepCost;
                if (candidate >= (gScores.get(edge.target) ?? Infinity)) continue;

                gScores.set(edge.target, candidate);
                parents.set(edge.target, current.value);
                parentEdges.set(edge.target, { ...edge, source: current.value });
                open.push(edge.target, candidate + heuristic(edge.target, endId), candidate);
            }
        }

        return null;
    }

    function conjuntoAristas(ruta) {
        return new Set((ruta && ruta.ids ? ruta.ids : []).slice(0, -1).map((id, index) => {
            return claveArista(id, ruta.ids[index + 1]);
        }));
    }

    function similitudAristas(rutaA, rutaB) {
        const a = conjuntoAristas(rutaA);
        const b = conjuntoAristas(rutaB);
        if (a.size === 0 && b.size === 0) return 1;
        let interseccion = 0;
        for (const edge of a) if (b.has(edge)) interseccion++;
        const union = a.size + b.size - interseccion;
        return union === 0 ? 1 : interseccion / union;
    }

    return {
        buscarRuta,
        claveArista,
        conjuntoAristas,
        coordenadasNodo,
        distanciaHaversine,
        similitudAristas
    };
});
