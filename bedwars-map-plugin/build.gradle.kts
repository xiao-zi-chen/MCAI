plugins { java }
group = "local.agx.prototype"
version = "0.2.0"
java { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }
dependencies { compileOnly("io.papermc.paper:paper-api:1.21-R0.1-SNAPSHOT") }
tasks.compileJava { options.encoding = "UTF-8"; options.release.set(21) }
tasks.processResources {
    from("../competition/rules.json") { rename { "competition-rules.json" } }
}
