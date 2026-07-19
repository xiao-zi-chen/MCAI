package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Locale;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class LocalizedTextTest {
    private static final Set<String> SUPPORTED = Set.of("en_us", "zh_cn");

    @Test
    void resolvesSimplifiedChineseClientLocales() {
        assertEquals("zh_cn", LocalizedText.resolveLanguage(Locale.SIMPLIFIED_CHINESE, "en_us", SUPPORTED));
        assertEquals("zh_cn", LocalizedText.resolveLanguage(Locale.forLanguageTag("zh-CN"), "en_us", SUPPORTED));
        assertEquals("zh_cn", LocalizedText.resolveLanguage(Locale.CHINESE, "en_us", SUPPORTED));
    }

    @Test
    void keepsDefaultForNonChineseClientLocales() {
        assertEquals("en_us", LocalizedText.resolveLanguage(Locale.US, "en_us", SUPPORTED));
        assertEquals("en_us", LocalizedText.resolveLanguage(null, "en_us", SUPPORTED));
    }
}
