package com.kya.pvprobo.control;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.Map;

public final class JsonProtocol {
    public static final int VERSION = 1;
    private static final Gson GSON = new Gson();

    private JsonProtocol() {
    }

    public static JsonObject decode(String line) {
        JsonObject object = JsonParser.parseString(line).getAsJsonObject();
        if (!object.has("v") || object.get("v").getAsInt() != VERSION) {
            throw new IllegalArgumentException("unsupported protocol version");
        }
        if (!object.has("id") || !object.has("type")) {
            throw new IllegalArgumentException("message missing id or type");
        }
        return object;
    }

    public static String encode(Map<String, Object> message) {
        return GSON.toJson(message);
    }
}

