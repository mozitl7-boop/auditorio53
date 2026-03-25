-- ==========================
-- 01 - Schema
-- ==========================

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  tipo_usuario VARCHAR(20) NOT NULL CHECK (tipo_usuario IN ('organizador', 'asistente')),
  telefono VARCHAR(20),
  departamento VARCHAR(50),
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auditorios (
  id VARCHAR(10) PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL,
  capacidad_total INTEGER NOT NULL,
  descripcion TEXT,
  equipamiento TEXT[],
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_auditorio VARCHAR(10) NOT NULL REFERENCES auditorios(id) ON DELETE CASCADE,
  numero_asiento INTEGER NOT NULL,
  fila VARCHAR(5) NOT NULL,
  seccion VARCHAR(50) NOT NULL,
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(id_auditorio, numero_asiento)
);

CREATE TABLE IF NOT EXISTS eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_auditorio VARCHAR(10) NOT NULL REFERENCES auditorios(id),
  id_organizador UUID NOT NULL REFERENCES usuarios(id),
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  asistentes_esperados INTEGER DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'confirmado' CHECK (estado IN ('confirmado', 'cancelado', 'pendiente')),
  tipo_evento VARCHAR(50),
  carrera VARCHAR(50),
  requiere_equipo BOOLEAN DEFAULT FALSE,
  notas_adicionales TEXT,
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registros_asistentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_evento UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  id_asistente UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado VARCHAR(20) DEFAULT 'confirmado' CHECK (estado IN ('confirmado', 'pendiente', 'cancelado')),
  fecha_registro TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  id_asiento UUID REFERENCES asientos(id),
  numero_orden INTEGER,
  UNIQUE(id_evento, id_asistente)
);

CREATE TABLE IF NOT EXISTS archivos_evento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_evento UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  nombre_archivo VARCHAR(255) NOT NULL,
  tipo_archivo VARCHAR(50),
  ruta_archivo TEXT NOT NULL,
  cargado_por UUID NOT NULL REFERENCES usuarios(id),
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(100) NOT NULL,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('registro', 'login', 'reset')),
  nombre VARCHAR(100),
  tipo_usuario VARCHAR(20),
  data_json JSONB,
  usado BOOLEAN DEFAULT FALSE,
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_expiracion TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
  fecha_uso TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token);
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_links_usuario_id ON magic_links(usuario_id);

-- ==========================
-- FUNCIONES
-- ==========================

CREATE OR REPLACE FUNCTION es_organizador_evento(
  p_id_usuario UUID,
  p_id_evento UUID
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM eventos
    WHERE id = p_id_evento AND id_organizador = p_id_usuario
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION eliminar_evento(
  p_id_evento UUID,
  p_id_usuario UUID
) RETURNS BOOLEAN AS $$
BEGIN
  IF NOT es_organizador_evento(p_id_usuario, p_id_evento) THEN
    RAISE EXCEPTION 'Solo el organizador puede eliminar este evento';
  END IF;

  DELETE FROM eventos WHERE id = p_id_evento;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 🔥 CORREGIDA
CREATE OR REPLACE FUNCTION asignar_asiento_automatico(
  p_id_evento UUID,
  p_id_asistente UUID
) RETURNS UUID AS $$
DECLARE
  v_id_asiento UUID;
  v_numero_orden INTEGER;
  v_id_auditorio VARCHAR(10);
BEGIN
  -- evitar duplicados
  IF EXISTS (
    SELECT 1 FROM registros_asistentes
    WHERE id_evento = p_id_evento AND id_asistente = p_id_asistente
  ) THEN
    RAISE EXCEPTION 'El asistente ya está registrado';
  END IF;

  SELECT id_auditorio INTO v_id_auditorio
  FROM eventos
  WHERE id = p_id_evento;

  SELECT COALESCE(MAX(numero_orden), 0) + 1 INTO v_numero_orden
  FROM registros_asistentes
  WHERE id_evento = p_id_evento;

  SELECT id INTO v_id_asiento
  FROM asientos
  WHERE id_auditorio = v_id_auditorio
    AND id NOT IN (
      SELECT id_asiento 
      FROM registros_asistentes 
      WHERE id_evento = p_id_evento AND id_asiento IS NOT NULL
    )
  ORDER BY numero_asiento
  LIMIT 1;

  IF v_id_asiento IS NULL THEN
    RAISE EXCEPTION 'No hay asientos disponibles';
  END IF;

  INSERT INTO registros_asistentes (id_evento, id_asistente, id_asiento, numero_orden)
  VALUES (p_id_evento, p_id_asistente, v_id_asiento, v_numero_orden);

  RETURN v_id_asiento;
END;
$$ LANGUAGE plpgsql;

-- ==========================
-- TRIGGERS
-- ==========================

CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_actualizacion = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_actualizar_usuarios
BEFORE UPDATE ON usuarios
FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trigger_actualizar_eventos
BEFORE UPDATE ON eventos
FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

-- ==========================
-- NOTIFICACIONES (CORREGIDO)
-- ==========================

CREATE TABLE IF NOT EXISTS notificaciones_enviadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_evento UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  tipo VARCHAR(50) NOT NULL,
  correo_destinatario TEXT NOT NULL,
  fecha_envio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(id_evento, tipo, correo_destinatario)
);

-- ==========================
-- SEED (CORREGIDO)
-- ==========================

INSERT INTO auditorios (id, nombre, capacidad_total, descripcion, equipamiento) VALUES
('A', 'Auditorio A', 168, 'Auditorio principal', ARRAY['proyector','audio']),
('B', 'Auditorio B', 168, 'Auditorio secundario', ARRAY['proyector','audio'])
ON CONFLICT (id) DO NOTHING;

-- ==========================
-- TABLA FINAL
-- ==========================

CREATE TABLE IF NOT EXISTS asientos_conteo (
  id_evento UUID PRIMARY KEY,
  datos JSONB NOT NULL,
  fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);