// Função simples de cálculo de distância (Haversine)
function toRad(value: number) {
    return (value * Math.PI) / 180;
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1Rad) * Math.cos(lat2Rad);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export function findNearestLife(userLat: number, userLon: number, lives: any[]) {
    let nearest = null;
    let minDistance = Infinity;

    for (const life of lives) {
        if (life.latitude && life.longitude) {
            const distance = calculateDistance(userLat, userLon, life.latitude, life.longitude);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = { ...life, distance };
            }
        }
    }
    return nearest;
}
