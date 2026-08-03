import json

def unificar_pesos_geojson(json_data):
    """
    Itera sobre todas las características (features) del GeoJSON
    y asegura que la propiedad 'peso' sea exactamente 2.
    """
    for feature in json_data.get("features", []):
        # Asegurar que exista la clave 'properties'
        if "properties" not in feature:
            feature["properties"] = {}
            
        # Asignar o sobrescribir el peso a 2 en todas las vialidades
        feature["properties"]["peso"] = 2
        
    return json_data

if __name__ == "__main__":
    # Nombre del archivo de entrada y salida
    archivo_entrada = "vialidades_final_completo.geojson"
    archivo_salida = "vialidades_peso_2.geojson"
    
    try:
        # Cargar el archivo GeoJSON
        with open(archivo_entrada, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        # Procesar los datos
        resultado = unificar_pesos_geojson(data)
        
        # Guardar el resultado procesado
        with open(archivo_salida, "w", encoding="utf-8") as f:
            json.dump(resultado, f, indent=2, ensure_ascii=False)
            
        print(f"Procesamiento completado. El resultado se guardó en '{archivo_salida}'.")
        
    except FileNotFoundError:
        print(f"Error: No se encontró el archivo '{archivo_entrada}'.")
    except json.JSONDecodeError:
        print("Error: El archivo de entrada no contiene un JSON válido o está incompleto.")