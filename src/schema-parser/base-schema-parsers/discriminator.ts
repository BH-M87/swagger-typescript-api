import * as lodash from "lodash";
import { SCHEMA_TYPES } from "../../constants.js";
import { MonoSchemaParser } from "../mono-schema-parser.js";

export class DiscriminatorSchemaParser extends MonoSchemaParser {
  override parse() {
    const ts = this.config.Ts;
    const { discriminator, ...noDiscriminatorSchema } = this.schema;

    if (!discriminator.mapping) {
      return this.schemaParserFabric
        .createSchemaParser({
          schema: noDiscriminatorSchema,
          typeName: this.typeName,
          schemaPath: this.schemaPath,
        })
        .parseSchema();
    }

    // https://github.com/acacode/swagger-typescript-api/issues/456
    // const skipMappingType = !!noDiscriminatorSchema.oneOf;
    const skipMappingType = false;

    const abstractSchemaStruct = this.createAbstractSchemaStruct();
    // const complexSchemaStruct = this.createComplexSchemaStruct();
    const discriminatorSchemaStruct = this.createDiscriminatorSchema({
      skipMappingType,
      abstractSchemaStruct,
    });

    const schemaContent = ts.IntersectionType(
      [
        (abstractSchemaStruct as any)?.content,
        (discriminatorSchemaStruct as any)?.content,
      ].filter(Boolean)
    );

    return {
      ...(typeof this.schema === "object" ? this.schema : {}),
      $schemaPath: this.schemaPath.slice(),
      $parsedSchema: true,
      schemaType: SCHEMA_TYPES.COMPLEX,
      type: SCHEMA_TYPES.PRIMITIVE,
      typeIdentifier: ts.Keyword.Type,
      name: this.typeName,
      description: this.schemaFormatters.formatDescription(
        this.schema.description,
        false
      ),
      content: schemaContent,
    };
  }

  createDiscriminatorSchema = ({
    skipMappingType,
    abstractSchemaStruct,
  }: {
    skipMappingType: any;
    abstractSchemaStruct: any;
  }) => {
    const ts = this.config.Ts;

    const refPath = this.schemaComponentsMap.createRef([
      "components",
      "schemas",
      this.typeName,
    ]);
    const { discriminator } = this.schema;
    const mappingEntries = lodash.entries(discriminator.mapping);
    const ableToCreateMappingType =
      !skipMappingType &&
      !!(abstractSchemaStruct?.typeName && mappingEntries.length);
    const mappingContents = [];
    let mappingTypeName: any;

    /** { mapping_key: SchemaEnum.MappingKey, ... } */
    const mappingPropertySchemaEnumKeysMap =
      this.createMappingPropertySchemaEnumKeys({
        abstractSchemaStruct,
        discPropertyName: discriminator.propertyName,
      });

    if (ableToCreateMappingType) {
      const rawTypeName = `${abstractSchemaStruct.typeName}_${discriminator.propertyName}`;
      const generatedTypeName = this.schemaUtils.resolveTypeName(rawTypeName, {
        suffixes: this.config.extractingOptions.discriminatorMappingSuffix,
        prefixes: [],
        resolver:
          this.config.extractingOptions.discriminatorMappingNameResolver,
      });

      const content = ts.IntersectionType([
        ts.ObjectWrapper(
          ts.TypeField({
            key: ts.StringValue(discriminator.propertyName),
            value: "Key",
          })
        ),
        "Type",
      ]);

      const component = this.schemaParserFabric.createParsedComponent({
        typeName: generatedTypeName,
        schema: {
          type: "object",
          properties: {},
          genericArgs: [{ name: "Key" }, { name: "Type" }],
          internal: true,
        },
        schemaPath: this.schemaPath,
      });

      if (component.typeData) {
        component.typeData.content = content as any;
      }

      mappingTypeName = this.typeNameFormatter.format(component.typeName);
    }

    /** returns (GenericType<"mapping_key", MappingType>) or ({ discriminatorProperty: "mapping_key" } & MappingType) */
    const createMappingContent = (mappingSchema: any, mappingKey: any) => {
      const content = this.schemaParserFabric
        .createSchemaParser({
          schema: mappingSchema,
          typeName: null,
          schemaPath: this.schemaPath,
        })
        .getInlineParseContent();

      const mappingUsageKey =
        (mappingPropertySchemaEnumKeysMap as any)[mappingKey] ||
        ts.StringValue(mappingKey);

      if (ableToCreateMappingType) {
        return ts.TypeWithGeneric(mappingTypeName, [mappingUsageKey, content]);
      }

      return ts.ExpressionGroup(
        ts.IntersectionType([
          ts.ObjectWrapper(
            ts.TypeField({
              key: discriminator.propertyName,
              value: mappingUsageKey,
            })
          ),
          content,
        ])
      );
    };

    for (const [mappingKey, schema] of mappingEntries) {
      const mappingSchema =
        typeof schema === "string" ? { $ref: schema } : schema;

      this.mutateMappingDependentSchema({
        discPropertyName: discriminator.propertyName,
        abstractSchemaStruct,
        mappingSchema,
        refPath,
        mappingPropertySchemaEnumKeysMap,
      });

      mappingContents.push(createMappingContent(mappingSchema, mappingKey));
    }

    if (skipMappingType) return null;

    const content = ts.ExpressionGroup(ts.UnionType(mappingContents));

    return {
      content,
    };
  };

  createMappingPropertySchemaEnumKeys = ({
    abstractSchemaStruct,
    discPropertyName,
  }: {
    abstractSchemaStruct: any;
    discPropertyName: any;
  }) => {
    const ts = this.config.Ts;

    let mappingPropertySchemaEnumKeysMap = {};
    let mappingPropertySchema = lodash.get(
      abstractSchemaStruct?.component?.rawTypeData,
      ["properties", discPropertyName]
    );
    if (this.schemaUtils.isRefSchema(mappingPropertySchema)) {
      mappingPropertySchema = this.schemaUtils.getSchemaRefType(
        mappingPropertySchema
      );
    }

    if (
      mappingPropertySchema?.rawTypeData?.$parsed?.type === SCHEMA_TYPES.ENUM
    ) {
      mappingPropertySchemaEnumKeysMap = lodash.reduce(
        mappingPropertySchema.rawTypeData.$parsed.enum,
        (acc, key, index) => {
          const enumKey =
            mappingPropertySchema.rawTypeData.$parsed.content[index].key;
          (acc as any)[key] = ts.EnumUsageKey(
            mappingPropertySchema.rawTypeData.$parsed.typeName,
            enumKey
          );
          return acc;
        },
        {}
      );
    }

    return mappingPropertySchemaEnumKeysMap;
  };

  mutateMappingDependentSchema = ({
    discPropertyName,
    abstractSchemaStruct,
    mappingSchema,
    refPath,
    mappingPropertySchemaEnumKeysMap,
  }: {
    discPropertyName: any;
    abstractSchemaStruct: any;
    mappingSchema: any;
    refPath: any;
    mappingPropertySchemaEnumKeysMap: any;
  }) => {
    const complexSchemaKeys = lodash.keys(
      this.schemaParser._complexSchemaParsers
    );
    // override parent dependencies
    if (mappingSchema.$ref && abstractSchemaStruct?.component?.$ref) {
      const mappingRefSchema =
        this.schemaUtils.getSchemaRefType(mappingSchema)?.rawTypeData;
      if (mappingRefSchema) {
        for (const schemaKey of complexSchemaKeys) {
          if (Array.isArray((mappingRefSchema as any)[schemaKey])) {
            (mappingRefSchema as any)[schemaKey] = (mappingRefSchema as any)[
              schemaKey
            ].map((schema: any) => {
              if (schema.$ref === refPath) {
                return {
                  ...schema,
                  $ref: abstractSchemaStruct.component.$ref,
                };
              }
              if (
                this.schemaUtils.getInternalSchemaType(schema) ===
                SCHEMA_TYPES.OBJECT
              ) {
                for (const schemaPropertyName in (schema as any).properties) {
                  const schemaProperty = (schema as any).properties[
                    schemaPropertyName
                  ];
                  if (
                    schemaPropertyName === discPropertyName &&
                    this.schemaUtils.getInternalSchemaType(schemaProperty) ===
                      SCHEMA_TYPES.ENUM &&
                    schemaProperty.enum.length === 1 &&
                    (mappingPropertySchemaEnumKeysMap as any)[
                      schemaProperty.enum[0]
                    ]
                  ) {
                    (schema as any).properties[schemaPropertyName] =
                      this.schemaParserFabric.createSchema({
                        content: (mappingPropertySchemaEnumKeysMap as any)[
                          schemaProperty.enum[0]
                        ],
                        linkedComponent: null,
                        schemaPath: this.schemaPath,
                      });
                  }
                }
              }
              return schema;
            });
          }
        }
      }
    }
  };

  createAbstractSchemaStruct = () => {
    const { discriminator, ...noDiscriminatorSchema } = this.schema;
    const complexSchemaKeys = lodash.keys(
      this.schemaParser._complexSchemaParsers
    );
    const schema = lodash.omit(
      structuredClone(noDiscriminatorSchema),
      complexSchemaKeys
    );
    const schemaContent = this.schemaParserFabric.getInlineParseContent(
      structuredClone(schema) as any,
      null,
      []
    );
    const schemaIsAny =
      typeof schemaContent === "string" &&
      schemaContent === this.config.Ts.Keyword.Any;
    const schemaIsEmpty = !lodash.keys(schema).length;

    if (schemaIsEmpty || schemaIsAny) return "any";

    const typeName = this.schemaUtils.resolveTypeName(this.typeName, {
      suffixes: [],
      prefixes: this.config.extractingOptions.discriminatorAbstractPrefix,
      resolver: this.config.extractingOptions.discriminatorAbstractResolver,
    });
    const component = this.schemaComponentsMap.createComponent(
      this.schemaComponentsMap.createRef([
        "components",
        "schemas",
        typeName || "Unknown",
      ]),
      {
        ...schema,
        internal: true,
      } as any
    );
    const content = this.schemaParserFabric
      .createSchemaParser({
        schema: component,
        typeName: null,
        schemaPath: this.schemaPath,
      })
      .getInlineParseContent();

    return {
      typeName,
      component,
      content,
    };
  };

  createComplexSchemaStruct = () => {
    const ts = this.config.Ts;
    const complexType = this.schemaUtils.getComplexType(this.schema);

    if (complexType === SCHEMA_TYPES.COMPLEX_UNKNOWN) return null;

    return {
      content: ts.ExpressionGroup(
        this.schemaParser._complexSchemaParsers[complexType](this.schema)
      ),
    };
  };
}
