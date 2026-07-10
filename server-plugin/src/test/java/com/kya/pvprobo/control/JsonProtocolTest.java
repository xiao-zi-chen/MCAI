package com.kya.pvprobo.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.google.gson.JsonObject;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class JsonProtocolTest {
    @Test
    void decodesValidMessage() {
        JsonObject object = JsonProtocol.decode("{\"v\":1,\"id\":\"p-1\",\"type\":\"ping\"}");
        assertEquals("p-1", object.get("id").getAsString());
        assertEquals("ping", object.get("type").getAsString());
    }

    @Test
    void rejectsUnsupportedVersion() {
        assertThrows(IllegalArgumentException.class, () -> JsonProtocol.decode("{\"v\":2,\"id\":\"p-1\",\"type\":\"ping\"}"));
    }

    @Test
    void encodesResponse() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("v", 1);
        response.put("id", "p-1");
        response.put("type", "pong");
        assertEquals("{\"v\":1,\"id\":\"p-1\",\"type\":\"pong\"}", JsonProtocol.encode(response));
    }
}

