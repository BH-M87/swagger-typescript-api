import { consola } from "consola";
import * as lodash from "lodash";
import type { CodeGenConfig } from "../configuration.js";
import { SCHEMA_TYPES } from "../constants.js";
import type { SchemaComponentsMap } from "../schema-components-map.js";
import type { SchemaWalker } from "../schema-walker.js";
import type { TemplatesWorker } from "../templates-worker.js";
import type { TypeNameFormatter } from "../type-name-formatter.js";
import { sortByProperty } from "../util/sort-by-property.js";
import { ArraySchemaParser } from "./base-schema-parsers/array.js";
import { ComplexSchemaParser } from "./base-schema-parsers/complex.js";
import { DiscriminatorSchemaParser } from "./base-schema-parsers/discriminator.js";
import { EnumSchemaParser } from "./base-schema-parsers/enum.js";
import { ObjectSchemaParser } from "./base-schema-parsers/object.js";
import { PrimitiveSchemaParser } from "./base-schema-parsers/primitive.js";
import { AllOfSchemaParser } from "./complex-schema-parsers/all-of.js";
import { AnyOfSchemaParser } from "./complex-schema-parsers/any-of.js";
import { NotSchemaParser } from "./complex-schema-parsers/not.js";
import { OneOfSchemaParser } from "./complex-schema-parsers/one-of.js";
import type { SchemaFormatters } from "./schema-formatters.js";
import type { SchemaParserFabric } from "./schema-parser-fabric.js";
import type { SchemaUtils } from "./schema-utils.js";

export class SchemaParser {
  schemaParserFabric: SchemaParserFabric;
  config: CodeGenConfig;
  schemaComponentsMap: SchemaComponentsMap;
  typeNameFormatter: TypeNameFormatter;
  schemaFormatters: SchemaFormatters;
  schemaUtils: SchemaUtils;
  templatesWorker: TemplatesWorker;
  schemaWalker: SchemaWalker;

  typeName;
  schema;
  schemaPath: any[] = [];

  // @ts-expect-error TS(2525) FIXME: Initializer provides no value for this binding ele... Remove this comment to see the full error message
  constructor(schemaParserFabric, { typeName, schema, schemaPath } = {}) {
    this.schemaParserFabric = schemaParserFabric;
    this.config = schemaParserFabric.config;
    this.templatesWorker = schemaParserFabric.templatesWorker;
    this.schemaComponentsMap = schemaParserFabric.schemaComponentsMap;
    this.typeNameFormatter = schemaParserFabric.typeNameFormatter;
    this.schemaWalker = schemaParserFabric.schemaWalker;
    this.schemaFormatters = schemaParserFabric.schemaFormatters;
    this.schemaUtils = schemaParserFabric.schemaUtils;

    this.typeName = typeName || null;
    this.schema = schema;
    this.schemaPath = [...(schemaPath || [])] as any[];
  }

  _complexSchemaParsers = {
    [SCHEMA_TYPES.COMPLEX_ONE_OF]: (schema: any) => {
      const SchemaParser =
        this.config.schemaParsers.complexOneOf || OneOfSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        null,
        this.schemaPath
      );
      return schemaParser.parse();
    },
    [SCHEMA_TYPES.COMPLEX_ALL_OF]: (schema: any) => {
      const SchemaParser =
        this.config.schemaParsers.complexAllOf || AllOfSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        null,
        this.schemaPath
      );
      return schemaParser.parse();
    },
    [SCHEMA_TYPES.COMPLEX_ANY_OF]: (schema: any) => {
      const SchemaParser =
        this.config.schemaParsers.complexAnyOf || AnyOfSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        null,
        this.schemaPath
      );
      return schemaParser.parse();
    },
    [SCHEMA_TYPES.COMPLEX_NOT]: (schema: any) => {
      const SchemaParser =
        this.config.schemaParsers.complexNot || NotSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        null,
        this.schemaPath
      );
      return schemaParser.parse();
    },
  };

  _baseSchemaParsers = {
    [SCHEMA_TYPES.ENUM]: (schema: any, typeName: any) => {
      const SchemaParser = this.config.schemaParsers.enum || EnumSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        typeName,
        this.schemaPath
      );
      return schemaParser.parse();
    },
    [SCHEMA_TYPES.OBJECT]: (schema: any, typeName: any) => {
      const SchemaParser =
        this.config.schemaParsers.object || ObjectSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        typeName,
        this.schemaPath
      );
      return schemaParser.parse();
    },
    [SCHEMA_TYPES.COMPLEX]: (schema: any, typeName: any) => {
      const SchemaParser =
        this.config.schemaParsers.complex || ComplexSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        typeName,
        this.schemaPath
      );
      return schemaParser.parse();
    },
    [SCHEMA_TYPES.PRIMITIVE]: (schema: any, typeName: any) => {
      const SchemaParser =
        this.config.schemaParsers.primitive || PrimitiveSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        typeName,
        this.schemaPath
      );
      return schemaParser.parse();
    },
    [SCHEMA_TYPES.DISCRIMINATOR]: (schema: any, typeName: any) => {
      const SchemaParser =
        this.config.schemaParsers.discriminator || DiscriminatorSchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        typeName,
        this.schemaPath
      );
      return schemaParser.parse();
    },
    [SCHEMA_TYPES.ARRAY]: (schema: any, typeName: any) => {
      const SchemaParser = this.config.schemaParsers.array || ArraySchemaParser;
      const schemaParser = new (SchemaParser as any)(
        this,
        schema,
        typeName,
        this.schemaPath
      );
      return schemaParser.parse();
    },
  };

  parseSchema = () => {
    if (!this.schema)
      return this._baseSchemaParsers[SCHEMA_TYPES.PRIMITIVE](
        null,
        this.typeName
      );

    let schemaType = null;
    let parsedSchema = null;

    if (typeof this.schema === "string") {
      return this.schema;
    }

    if (!this.schema.$parsed) {
      if (!this.typeName && this.schemaUtils.isRefSchema(this.schema)) {
        this.typeName = this.schemaUtils.getSchemaType(this.schema);
      }

      //#region swagger schemas fixes

      // schema has items but don't have array type
      if (
        this.schema.items &&
        !Array.isArray(this.schema.items) &&
        !this.schema.type
      ) {
        this.schema.type = SCHEMA_TYPES.ARRAY;
      }
      // schema is enum with one null value
      if (
        Array.isArray(this.schema.enum) &&
        this.schema.enum.length === 1 &&
        this.schema.enum[0] == null
      ) {
        consola.debug("invalid enum schema", this.schema);
        this.schema = { type: this.config.Ts.Keyword.Null };
      }
      // schema is response schema
      if ("content" in this.schema && typeof this.schema.content === "object") {
        const schema = this.extractSchemaFromResponseStruct(this.schema);
        const schemaParser = this.schemaParserFabric.createSchemaParser({
          schema,
          typeName: this.typeName,
          schemaPath: this.schemaPath,
        });
        this.schema.$parsed = schemaParser.parseSchema();
        return this.schema.$parsed;
      }

      //#endregion

      schemaType = this.schemaUtils.getInternalSchemaType(this.schema);

      (this.schemaPath as any[]).push(this.typeName);

      lodash.merge(
        this.schema,
        this.config.hooks.onPreParseSchema(
          this.schema,
          this.typeName,
          schemaType
        )
      );
      parsedSchema = this._baseSchemaParsers[schemaType](
        this.schema,
        this.typeName
      );
      this.schema.$parsed =
        this.config.hooks.onParseSchema(this.schema, parsedSchema) ||
        parsedSchema;

      if (
        this.config.sortTypes &&
        Array.isArray(this.schema.$parsed?.content)
      ) {
        this.schema.$parsed.content = this.schema.$parsed.content.sort(
          sortByProperty("name")
        );
      }
    }

    this.schemaPath.pop();

    return this.schema.$parsed;
  };

  getInlineParseContent = () => {
    const parsedSchema = this.parseSchema();
    const formattedSchema = this.schemaFormatters.formatSchema(
      parsedSchema,
      "inline"
    );
    return formattedSchema.content;
  };

  getParseContent = () => {
    const parsedSchema = this.parseSchema();
    const formattedSchema = this.schemaFormatters.formatSchema(
      parsedSchema,
      "base"
    );
    return formattedSchema.content;
  };

  extractSchemaFromResponseStruct = (responseStruct: any) => {
    const { content, ...extras } = responseStruct;

    const firstResponse = lodash.first(lodash.values(content));
    const firstSchema = lodash.get(firstResponse, "schema");

    if (!firstSchema) return;

    return {
      ...extras,
      ...lodash.omit(firstResponse, "schema"),
      ...firstSchema,
    };
  };
}
