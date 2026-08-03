import geopandas as gpd

def asignar_pesos_por_dibujo():
    print("Cargando archivos...")
    # Cargar los GeoJSON
    vd = gpd.read_file('vialidades_destacadas.geojson')
    vs = gpd.read_file('vialidades_final_completo.geojson')

    # 1. Reproyectar a UTM (Zona 14N) para operar con metros exactos
    print("Reproyectando geometrías...")
    vd = vd.to_crs(epsg=32614)
    vs = vs.to_crs(epsg=32614)

    # 2. Generar el "dibujo" base
    # Se aplica un buffer de 5 metros al trazo original para darle volumen físico.
    # unary_union fusiona todas las vialidades destacadas en una sola geometría combinada.
    print("Generando la huella del dibujo base...")
    dibujo_destacadas = vd.geometry.buffer(5).unary_union

    # 3. Lógica de clasificación
    def calcular_peso(geometria):
        # Si la línea cruza o está dentro de la huella del dibujo, se le asigna peso 1
        if geometria.intersects(dibujo_destacadas):
            return 1
        # Si la línea está completamente fuera de la huella, se le asigna peso 2
        return 2

    # 4. Evaluar las geometrías y asignar el peso
    print("Analizando intersecciones y asignando pesos...")
    vs['peso'] = vs.geometry.apply(calcular_peso)

    # 5. Regresar al estándar web/GPS (WGS84)
    print("Regresando a proyección original (WGS84)...")
    vs = vs.to_crs(epsg=4326)

    # 6. Guardar archivo resultante
    # El archivo de salida conserva todas tus geometrías secundarias pero ahora incluye la columna 'peso'
    output_filename = 'vialidades_unificadas_con_pesos.geojson'
    print("Escribiendo el archivo resultante en disco...")
    vs.to_file(output_filename, driver='GeoJSON')
    
    print(f"¡Proceso terminado! Archivo generado con éxito: {output_filename}")

if __name__ == "__main__":
    asignar_pesos_por_dibujo()