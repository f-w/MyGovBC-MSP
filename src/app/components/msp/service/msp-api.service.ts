import {Injectable, Inject} from '@angular/core';
import {MspApplication} from "../model/application.model";
import {
  GenderType, NameType, AttachmentUuidsType, AddressType, NameTypeFactory,
  AttachmentUuidsTypeFactory, BasicCitizenshipTypeFactory, AddressTypeFactory
} from "../api-model/commonTypes";
import {Address} from "../model/address.model";
import {Person} from "../model/person.model";
import {
  ResidencyType, EnrolmentApplicationType, EnrolmentApplicantType,
  EnrolmentChildrenType, PersonTypeFactory, ResidencyTypeFactory, LivedInBCTypeFactory, EnrolmentApplicationTypeFactory,
  EnrolmentApplicantTypeFactory, EnrolmentChildrenTypeFactory, PreviousCoverageTypeFactory, OutsideBCTypeFactory,
  WillBeAwayTypeFactory, DependentType, DependentTypeFactory, EnrolmentDependentsTypeFactory
} from "../api-model/enrolmentTypes";
import {StatusInCanada, Activities, Relationship} from "../model/status-activities-documents";
import {CitizenshipType} from "../api-model/commonTypes";
import {BasicCitizenshipType} from "../api-model/commonTypes";
import {LivedInBCType} from "../api-model/enrolmentTypes";
import {PersonType} from "../api-model/enrolmentTypes";
import {
  ApplicationType, AttachmentsType, document, _ApplicationTypeNameSpace,
  AttachmentType, ApplicationTypeFactory, DocumentFactory, AttachmentsTypeFactory, AttachmentTypeFactory
} from "../api-model/applicationTypes";
import {MspImage} from "../model/msp-image";
import {PersonDocuments} from "../model/person-document.model";
import {ResponseType} from "../api-model/responseTypes";
import {Http, Response, Headers, RequestOptions} from "@angular/http";
import * as moment from "moment";
import ISO_8601 = moment.ISO_8601;
import {FinancialAssistApplication, AssistanceApplicationType} from "../model/financial-assist-application.model";
import {
  AssistanceApplicationTypeFactory, AssistanceApplicantType,
  AssistanceApplicantTypeFactory, FinancialsType, FinancialsTypeFactory, AssistanceSpouseTypeFactory
} from "../api-model/assistanceTypes";
import {ApplicationBase} from "../model/application-base.model";
import {AssistanceYear} from "../model/assistance-year.model";
let jxon = require("jxon/jxon");

@Injectable()
export class MspApiService {

  constructor(private http: Http, @Inject('appConstants') private appConstants: Object) {
  }

  /**
   * Sends the Application and returns an MspApplication if successful with referenceNumber populated
   * @param app
   * @returns {Promise<MspApplication>}
   */
  sendApplication(app: ApplicationBase): Promise<ApplicationBase> {

    return new Promise<ApplicationBase>((resolve, reject) => {
      console.log("Start sending...");

      try {

        let documentModel: document;
        if (app instanceof MspApplication) {
          documentModel = this.convertMspApplication(app);
        } else if (app instanceof FinancialAssistApplication) {
          documentModel = this.convertAssistance(app);
        }
        else {
          throw new Error("Unknown document type");
        }

        // Check for authorization token
        if (app.authorizationToken == null ||
          app.authorizationToken.length < 1) {
          throw new Error("Missing authorization token.");
        }

        // second convert to XML
        let convertedAppXml = this.toXmlString(documentModel);

        // if no errors, then we'll sendApplication all attachments
        return this.sendAttachments(app.authorizationToken, documentModel.application.uuid, app.getAllImages()).then(() => {

          // once all attachments are done we can sendApplication in the data
          return this.sendDocument(app.authorizationToken, documentModel).then(
            (response: ResponseType) => {
              console.log("sent application resolved");
              // Add reference number
              app.referenceNumber = response.referenceNumber.toString();

              // Let our caller know were done passing back the application
              return resolve(app);
            },
          
            (error: Response | any) => {
              return reject(error);
            }          
          )
        })
        .catch((error: Response | any) => {
            console.log("sent all attachments rejected: ", error);
            return reject(error);
          });
      } catch (error) {
        console.log("error: ", error);
        return reject(error);
      }
    });
  }

  private sendAttachments(token: string, applicationUUID: string, attachments: MspImage[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {

      // Instantly resolve if no attachments
      if (!attachments || attachments.length < 1) {
        resolve();
      }

      // Make a list of promises for each attachment
      let attachmentPromises = new Array<Promise<ResponseType>>();
      for (let attachment of attachments) {
        attachmentPromises.push(this.sendAttachment(token, applicationUUID, attachment));
      }
      // Execute all promises are waiting for results
      return Promise.all(attachmentPromises).then(
        (responses: ResponseType[]) => {
          return resolve();
        },
        (error: Response | any) => {
        console.log("error sending attachment: ", error);
          return reject(error);
        }
      )
      .catch((error: Response | any) => {
        console.log("error sending attachment: ", error);
        return reject(error);
      });
    });
  }

  private sendAttachment(token: string, applicationUUID: string, attachment: MspImage): Promise<ResponseType> {
    return new Promise<ResponseType>((resolve, reject) => {

      /*
       Create URL
       /{applicationUUID}/attachment/{attachmentUUID}
       */
      let url = this.appConstants['apiBaseUrl']
        + "/MSPDESubmitAttachment/" + applicationUUID
        + "/attachment/" + attachment.uuid;

      // programArea
      url += "?programArea=enrolment";

      // attachmentDocumentType - UI does NOT collect this property
      url += "&attachmentDocumentType=" + MspApiService.AttachmentDocumentType;

      // contentType
      url += "&contentType=" + attachment.contentType;

      // imageSize
      url += "&imageSize=" + attachment.size;

      // description - UI does NOT collect this property

      // Setup headers
      let headers = new Headers({
        'Content-Type': attachment.contentType,
        'Access-Control-Allow-Origin': '*',
        'X-Authorization': 'Bearer ' + token
      });
      let options = new RequestOptions({headers: headers});

      let binary = atob(attachment.fileContent.split(',')[1]);
      let array = <any>[];
      for (var i = 0; i < binary.length; i++) {
        array.push(binary.charCodeAt(i));
      }
      let blob = new Blob([new Uint8Array(array)], {type: attachment.contentType});

      return this.http
        .post(url, blob, options)
        .toPromise()
        .then((response: Response) => {
          return resolve(<ResponseType>{
            status: response.status + ''
          });
        },
          (error: Response|any) => {
            console.log('error response in its origin form: ', error);
            return reject(error);
          }
        )
        .catch((error: Response | any) => {
          console.log("Error in sending individual attachment: ", error);
          let response = this.convertResponse(error);
          reject(response || error);
        });
    });
  }


  /**
   * Sends the application XML, last step in overall transaction
   * @param document
   * @returns {Promise<ResponseType>}
   */
  private sendDocument(token: string, document: document): Promise<ResponseType> {
    return new Promise<ResponseType>((resolve, reject) => {
      /*
       Create URL
       /{applicationUUID}
       */
      let url = this.appConstants['apiBaseUrl']
        + "/MSPDESubmitApplication/" + document.application.uuid
        + "?programArea=enrolment";

      // Setup headers
      let headers = new Headers({
        'Content-Type': 'application/xml',
        'X-Authorization': 'Bearer ' + token});
      let options = new RequestOptions({headers: headers});

      // Convert doc to XML
      let documentXmlString = this.toXmlString(document);

      return this.http.post(url, documentXmlString, options)
        .toPromise()
        .then((response: Response) => {
          console.log("sent application resolved");
          return resolve(this.convertResponse(response.text()));
        })
        .catch((error: Response | any) => {
          console.log("full error: ", error)
          return reject(error);
        });
    });
  }

  convertResponse(responseBody: string): ResponseType {
    return this.stringToJs<ResponseType>(responseBody)["ns2:response"];
  }


  /**
   * Start of MSP Application converted converter operation
   * @param from
   * @returns {applicationTypes.ApplicationType}
   */
  convertMspApplication(from: MspApplication): document {
    // Instantiate new object from interface
    let to = DocumentFactory.make();
    to.application = ApplicationTypeFactory.make();

    // UUID
    to.application.uuid = from.uuid;

    // Init data structure
    to.application.enrolmentApplication = EnrolmentApplicationTypeFactory.make();

    // Applicant section
    to.application.enrolmentApplication.applicant = EnrolmentApplicantTypeFactory.make();
    to.application.enrolmentApplication.applicant.name = this.convertName(from.applicant);

    /*
     birthDate: Date;
     gender: GenderType;
     */
    to.application.enrolmentApplication.applicant.attachmentUuids = this.convertAttachmentUuids(from.applicant.documents.images);

    if (from.applicant.hasDob) {
      to.application.enrolmentApplication.applicant.birthDate = from.applicant.dob.format(this.ISO8601DateFormat);
    }
    if (from.applicant.gender != null) {
      to.application.enrolmentApplication.applicant.gender = <GenderType>{};
      to.application.enrolmentApplication.applicant.gender = <GenderType> from.applicant.gender.toString();
    }
    /*
     authorizedByApplicant: ct.YesOrNoType;
     authorizedByApplicantDate: Date;
     authorizedBySpouse: ct.YesOrNoType;
     */
    if (from.authorizedByApplicant != null) {
      to.application.enrolmentApplication.applicant.authorizedByApplicant = from.authorizedByApplicant ? "Y" : "N";
      to.application.enrolmentApplication.applicant.authorizedByApplicantDate = moment(from.authorizedByApplicantDate)
        .format(this.ISO8601DateFormat);
    }
    if (from.authorizedBySpouse != null) {
      to.application.enrolmentApplication.applicant.authorizedBySpouse = from.authorizedBySpouse ? "Y" : "N";
    }
    /*
     mailingAddress?: ct.AddressType;
     residenceAddress: ct.AddressType;
     residency: ResidencyType;
     telephone: number;
     */
    if (!from.mailingSameAsResidentialAddress) {
      to.application.enrolmentApplication.applicant.mailingAddress = this.convertAddress(from.mailingAddress);
    }
    to.application.enrolmentApplication.applicant.residenceAddress = this.convertAddress(from.residentialAddress);

    to.application.enrolmentApplication.applicant.residency = this.convertResidency(from.applicant);
    if (from.phoneNumber) {
      to.application.enrolmentApplication.applicant.telephone = Number(from.phoneNumber.replace(new RegExp("[^0-9]", "g"), ""));
    }

    // Convert spouse
    if (from.spouse) {
      to.application.enrolmentApplication.spouse = this.convertPersonFromEnrollment(from.spouse);
    }

    // Convert children and dependants
    if (from.children &&
      from.children.length > 0) {

      // Filter out children vs dependants
      let children = from.children.filter((child:Person) =>
        { return child.relationship === Relationship.ChildUnder19});
      let dependants = from.children.filter((child:Person) =>
        { return child.relationship === Relationship.Child19To24});

      // Children
      if (children.length > 0) {
        to.application.enrolmentApplication.children = EnrolmentChildrenTypeFactory.make();
        to.application.enrolmentApplication.children.child = new Array<PersonType>();
        for (let child of children) {
          to.application.enrolmentApplication.children.child.push(this.convertPersonFromEnrollment(child));
        }
      }

      // Dependants
      if (dependants.length > 0) {
        to.application.enrolmentApplication.dependents = EnrolmentDependentsTypeFactory.make();
        to.application.enrolmentApplication.dependents.dependent = new Array<DependentType>();
        for (let dependant of dependants) {
          to.application.enrolmentApplication.dependents.dependent.push(this.convertDependantFromEnrollment(dependant));
        }
      }
    }

    // Convert attachments
    to.application.attachments = this.convertAttachmentsForEnrolment(from);

    return to;
  }

  convertAssistance(from: FinancialAssistApplication): document {
    // Instantiate new object from interface
    let to = DocumentFactory.make();
    to.application = ApplicationTypeFactory.make();

    // UUID
    to.application.uuid = from.uuid;

    // Init assistance
    to.application.assistanceApplication = AssistanceApplicationTypeFactory.make();

    /*
     attachmentUuids: AttachmentUuidsType;
     birthDate: string;
     gender: GenderType;
     name: NameType;
     */
    to.application.assistanceApplication.applicant = AssistanceApplicantTypeFactory.make();
    to.application.assistanceApplication.applicant.name = this.convertName(from.applicant);

    if (from.applicant.hasDob) {
      to.application.assistanceApplication.applicant.birthDate = from.applicant.dob.format(this.ISO8601DateFormat);
    }
    if (from.applicant.gender != null) {
      to.application.assistanceApplication.applicant.gender = <GenderType> from.applicant.gender.toString();
    }
    if (from.powerOfAttorneyDocs && from.powerOfAttorneyDocs.length > 0) {
      to.application.assistanceApplication.applicant.attachmentUuids = this.convertAttachmentUuids(from.powerOfAttorneyDocs);
    }

    /*
     financials: FinancialsType;
     mailingAddress?: ct.AddressType;
     phn: number;
     powerOfAttorny: ct.YesOrNoType;
     residenceAddress: ct.AddressType;
     SIN: number;
     telephone: number;
     */
    to.application.assistanceApplication.applicant.financials = this.convertFinancial(from);
    to.application.assistanceApplication.applicant.mailingAddress = this.convertAddress(from.mailingAddress);

    if (from.applicant.previous_phn) {
      to.application.assistanceApplication.applicant.phn = Number(from.applicant.previous_phn.replace(new RegExp("[^0-9]", "g"), ""));
    }
    if (from.hasPowerOfAttorney)
      to.application.assistanceApplication.applicant.powerOfAttorney = "Y";
    else {
      to.application.assistanceApplication.applicant.powerOfAttorney = "N";
    }

    if (from.applicant.sin) {
      to.application.assistanceApplication.applicant.SIN = Number(from.applicant.sin.replace(new RegExp("[^0-9]", "g"), ""));
    }
    if (from.phoneNumber) {
      to.application.assistanceApplication.applicant.telephone = Number(from.phoneNumber.replace(new RegExp("[^0-9]", "g"), ""));
    }
    /*
     authorizedByApplicant: ct.YesOrNoType;
     authorizedByApplicantDate: Date;
     authorizedBySpouse: ct.YesOrNoType;
     authorizedBySpouseDate: Date;
     spouse?: AssistanceSpouseType;
     */
    to.application.assistanceApplication.authorizedByApplicantDate =
      moment(from.authorizedByApplicantDate).format(this.ISO8601DateFormat);
    if (from.authorizedByApplicant) {
      to.application.assistanceApplication.authorizedByApplicant = "Y";

    }
    else {
      to.application.assistanceApplication.authorizedByApplicant = "N";
    }
    if (from.authorizedBySpouse) {
      to.application.assistanceApplication.authorizedBySpouse = "Y";
    }
    else {
      to.application.assistanceApplication.authorizedBySpouse = "N";
    }

    if (from.hasSpouseOrCommonLaw) {
      to.application.assistanceApplication.spouse = AssistanceSpouseTypeFactory.make();

      /*
       name: ct.NameType;
       phn?: number;
       SIN?: number;
       spouseDeduction?: number;
       spouseSixtyFiveDeduction?: number;
       */
      to.application.assistanceApplication.spouse.name = this.convertName(from.spouse);
      if (from.spouse.previous_phn) {
        to.application.assistanceApplication.spouse.phn = Number(from.spouse.previous_phn.replace(new RegExp("[^0-9]", "g"), ""));
      }
      if (from.spouse.sin) {
        to.application.assistanceApplication.spouse.SIN = Number(from.spouse.sin.replace(new RegExp("[^0-9]", "g"), ""));
      }

      /*
       spouseDeduction?: number;
       spouseSixtyFiveDeduction?: number;
       */
      if (from.eligibility.spouseDeduction != null) {
        to.application.assistanceApplication.spouse.spouseDeduction = from.eligibility.spouseDeduction;
      }
      if (from.eligibility.spouseSixtyFiveDeduction != null) {
        to.application.assistanceApplication.spouse.spouseSixtyFiveDeduction = from.eligibility.spouseSixtyFiveDeduction;
      }
    }

    // Convert attachments
    let attachments = this.convertAttachmentsForAssistance(from);
    if (attachments != null) {
      to.application.attachments = attachments;
    }

    return to;
  }

  private convertFinancial(from: FinancialAssistApplication): FinancialsType {
    let to = FinancialsTypeFactory.make();

    /*
     adjustedNetIncome?: number;          // adjustedNetIncome
     assistanceYear: AssistanceYearType;  // "CurrentPA" TODO: ticket in JIRA to address this
     childCareExpense?: number;           // claimedChildCareExpense_line214
     childDeduction?: number;             // childDeduction
     deductions?: number;                 // deductions
     disabilityDeduction?: number;        // disabilityDeduction
     disabilitySavingsPlan?: number;      // spouseDSPAmount_line125
     netIncome: number;                   // netIncomelastYear
     numChildren?: number;                // childrenCount
     numDisabled?: number;                // numDisabled
     sixtyFiveDeduction?: number;         // both applicant and spouse
     spouseNetIncome?: number;            // spouseIncomeLine236
     taxYear: number;                     // Current Year, if multiple the recent selected
     totalDeductions?: number;            // totalDeductions
     totalNetIncome?: number;             // totalNetIncome, applicant and spouse
     uccb?: number;                       // reportedUCCBenefit_line117
                                         // ageOver65
                                         // hasSpouseOrCommonLaw
                                         // spouseAgeOver65
                                         // spouseEligibleForDisabilityCredit
                                         // selfDisabilityCredit
                                         // deductionDifference?
     */

    switch (from.getAssistanceApplicationType()) {
      case AssistanceApplicationType.CurrentYear:
        to.assistanceYear = "CurrentPA";
        break;
      case AssistanceApplicationType.PreviousTwoYears:
        to.assistanceYear = "PreviousTwo";
        break;
      case AssistanceApplicationType.MultiYear:
        to.assistanceYear = "MultiYear";
        break;
    }
    to.taxYear = from.getTaxYear();
    to.numberOfTaxYears = from.numberOfTaxYears();
    if (from.eligibility.adjustedNetIncome != null) to.adjustedNetIncome = from.eligibility.adjustedNetIncome;
    if (from.eligibility.childDeduction != null) to.childDeduction = from.eligibility.childDeduction;
    if (from.eligibility.deductions != null) to.deductions = from.eligibility.deductions;
    if (from.disabilityDeduction > 0) to.disabilityDeduction = from.disabilityDeduction;
    if (from.eligibility.sixtyFiveDeduction != null) to.sixtyFiveDeduction = from.eligibility.sixtyFiveDeduction;
    if (from.eligibility.totalDeductions != null) to.totalDeductions = from.eligibility.totalDeductions;
    if (from.eligibility.totalNetIncome != null) to.totalNetIncome = from.eligibility.totalNetIncome;
    if (from.claimedChildCareExpense_line214 != null) to.childCareExpense = from.claimedChildCareExpense_line214;
    if (from.netIncomelastYear != null) to.netIncome = from.netIncomelastYear;
    if (from.childrenCount != null && from.childrenCount > 0) to.numChildren = from.childrenCount;
    if (from.numDisabled > 0) to.numDisabled = from.numDisabled;
    if (from.spouseIncomeLine236 != null) to.spouseNetIncome = from.spouseIncomeLine236;
    if (from.netIncomelastYear != null) to.netIncome = from.netIncomelastYear;
    if (from.reportedUCCBenefit_line117 != null) to.uccb = from.reportedUCCBenefit_line117;
    if (from.spouseDSPAmount_line125 != null) to.disabilitySavingsPlan = from.spouseDSPAmount_line125;


    return to;
  }

  /**
   * User does NOT specify document type therefore we always say its a supporting document
   * @type {string}
   */
  static readonly AttachmentDocumentType = "SupportDocument";

  /**
   * Creates the array of attachments from applicant, spouse and all children
   * @param from
   * @returns {AttachmentsType}
   */
  private convertAttachmentsForEnrolment(from: MspApplication): AttachmentsType {

    let to = AttachmentsTypeFactory.make();
    to.attachment = new Array<AttachmentType>();

    // assemble all attachments
    let attachments: MspImage[] = from.getAllImages();

    // Convert each one
    for (let attachment of attachments) {
      // Init new attachment with defaults
      let toAttachment = AttachmentTypeFactory.make();
      toAttachment.attachmentDocumentType = MspApiService.AttachmentDocumentType;

      // Content type
      switch (attachment.contentType) {
        case "image/jpeg":
          toAttachment.contentType = "image/jpeg";
          break;
        case "application/pdf":
          toAttachment.contentType = "application/pdf";
          break;
      }

      // uuid
      toAttachment.attachmentUuid = attachment.uuid;

      // user does NOT provide description so it's left blank for now, may be used in future

      // Add to array
      to.attachment.push(toAttachment);
    }

    return to;
  }

  /**
   * Creates the array of attachments from applicant, spouse and all children
   * @param from
   * @returns {AttachmentsType}
   */
  private convertAttachmentsForAssistance(from: FinancialAssistApplication): AttachmentsType {

    let to = AttachmentsTypeFactory.make();
    to.attachment = new Array<AttachmentType>();

    // assemble all attachments
    let attachments: MspImage[] = from.getAllImages();

    // If no attachments just return
    if (!attachments || attachments.length < 1) {
      console.log("no attachments");
      return null;
    }

    // Convert each one
    for (let attachment of attachments) {
      // Init new attachment with defaults
      let toAttachment = AttachmentTypeFactory.make();
      toAttachment.attachmentDocumentType = MspApiService.AttachmentDocumentType;

      // Content type
      switch (attachment.contentType) {
        case "image/jpeg":
          toAttachment.contentType = "image/jpeg";
          break;
        case "application/pdf":
          toAttachment.contentType = "application/pdf";
          break;
        default:
        //TODO: throw error on bad content type
      }

      // uuid
      toAttachment.attachmentUuid = attachment.uuid;

      // user does NOT provide description so it's left blank for now, may be used in future

      // Add to array
      to.attachment.push(toAttachment);
    }

    return to;
  }


  private convertPersonFromEnrollment(from: Person): PersonType {
    let to = PersonTypeFactory.make();

    to.name = this.convertName(from);
    to.attachmentUuids = this.convertAttachmentUuids(from.documents.images);

    if (from.hasDob) {
      to.birthDate = from.dob.format(this.ISO8601DateFormat);
    }
    if (from.gender != null) {
      to.gender = <GenderType> from.gender.toString();
    }
    to.residency = this.convertResidency(from);

    return to;
  }

  private convertDependantFromEnrollment(from: Person): DependentType {
    // Do base type first
    let to = <DependentType>this.convertPersonFromEnrollment(from);

    // Copy sequence over
    to._sequence = DependentTypeFactory.make()._sequence;

    to.schoolName = from.schoolName;
    if (from.hasStudiesDeparture) {
      to.departDateSchoolOutside = from.studiesDepartureDate.format(this.ISO8601DateFormat);
    }
    if (from.hasStudiesFinished) {
      to.dateStudiesFinish = from.studiesFinishedDate.format(this.ISO8601DateFormat);
    }

    // Assemble address string
    to.schoolAddress = this.convertAddress(from.schoolAddress);

    return to;
  }

  private convertName(from: Person): NameType {
    let to = NameTypeFactory.make();

    /*
     firstName: string;
     lastName: string;
     secondName?: string;
     */
    to.firstName = from.firstName;
    to.secondName = from.middleName;
    to.lastName = from.lastName;

    return to;
  }

  private convertAttachmentUuids(from: MspImage[]): AttachmentUuidsType {
    let to = AttachmentUuidsTypeFactory.make();

    to.attachmentUuid = new Array<string>();
    for (let image of from) {
      to.attachmentUuid.push(image.uuid);
    }

    return to;
  }

  private convertResidency(from: Person): ResidencyType {
    let to = ResidencyTypeFactory.make();

    /*
     citizenshipStatus: ct.BasicCitizenshipType;
     livedInBC: LivedInBCType;
     outsideBC: OutsideBCType;
     previousCoverage: PreviousCoverageType;
     willBeAway: WillBeAwayType;
     */

    //("Citizen" | "PermanentResident" | "WorkPermit" | "StudyPermit" | "Diplomat" | "VisitorPermit");
    to.citizenshipStatus = BasicCitizenshipTypeFactory.make();
    switch (from.status) {
      case StatusInCanada.CitizenAdult:
        to.citizenshipStatus.citizenshipType = "CanadianCitizen";
        break;
      case StatusInCanada.PermanentResident:
        to.citizenshipStatus.citizenshipType = "PermanentResident";
        break;
      case StatusInCanada.TemporaryResident:
        switch (from.currentActivity) {
          case Activities.WorkingInBC:
            to.citizenshipStatus.citizenshipType = "WorkPermit";
            break;
          case Activities.StudyingInBC:
            to.citizenshipStatus.citizenshipType = "StudyPermit";
            break;
          case Activities.Diplomat:
            to.citizenshipStatus.citizenshipType = "Diplomat";
            break;
          case Activities.Visiting:
          default:
            to.citizenshipStatus.citizenshipType = "VisitorPermit";
            break;
        }
    }
    to.citizenshipStatus.attachmentUuids = AttachmentUuidsTypeFactory.make();
    to.citizenshipStatus.attachmentUuids.attachmentUuid = new Array<string>();
    for (let image of from.documents.images) {
      to.citizenshipStatus.attachmentUuids.attachmentUuid.push(image.uuid);
    }

    /*
     hasLivedInBC: ct.YesOrNoType;
     isPermanentMove?: ct.YesOrNoType;
     prevHealthNumber?: string;
     prevProvinceOrCountry?: string;
     recentBCMoveDate?: Date;
     recentCanadaMoveDate?: Date;

     beenOutsideBCMoreThan: ct.YesOrNoType;
     departureDate?: Date;
     familyMemberReason?: string;
     returnDate?: Date;
     */
    // Init and set defaults
    to.livedInBC = LivedInBCTypeFactory.make();

    if (from.livedInBCSinceBirth === true) {
      to.livedInBC.hasLivedInBC = "Y";
    }
    else {
      to.livedInBC.hasLivedInBC = "N";
    }
    to.livedInBC.isPermanentMove = from.madePermanentMoveToBC === true? "Y":"N"; 

    if (from.healthNumberFromOtherProvince) {
      to.livedInBC.prevHealthNumber = from.healthNumberFromOtherProvince; // out of province health numbers
    }
    if (from.movedFromProvinceOrCountry) {
      to.livedInBC.prevProvinceOrCountry = from.movedFromProvinceOrCountry;
    }


    // Arrival dates
    if (from.hasArrivalToBC) {
      to.livedInBC.recentBCMoveDate = from.arrivalToBC.format(this.ISO8601DateFormat);
    }
    if (from.hasArrivalToCanada) {
      to.livedInBC.recentCanadaMoveDate = from.arrivalToCanada.format(this.ISO8601DateFormat);
    }

    // Outside BC
    to.outsideBC = OutsideBCTypeFactory.make();
    if (from.outOfBCRecord) {
      to.outsideBC.beenOutsideBCMoreThan = "Y";
      if (from.outOfBCRecord.hasDeparture) {
        to.outsideBC.departureDate = from.outOfBCRecord.departureDate.format(this.ISO8601DateFormat);
      }
      if (from.outOfBCRecord.hasReturn) {
        to.outsideBC.returnDate = from.outOfBCRecord.returnDate.format(this.ISO8601DateFormat);
      }
      to.outsideBC.familyMemberReason = from.outOfBCRecord.reason;
      to.outsideBC.destination = from.outOfBCRecord.location;
    }
    else {
      to.outsideBC.beenOutsideBCMoreThan = "N";
    }

    /*
     armedDischageDate?: Date;
     isFullTimeStudent: ct.YesOrNoType;
     isInBCafterStudies?: ct.YesOrNoType;
     */
    to.willBeAway = WillBeAwayTypeFactory.make();
    if (from.fullTimeStudent) {
      to.willBeAway.isFullTimeStudent = "Y";
    }
    else {
      to.willBeAway.isFullTimeStudent = "N";
    }
    if (from.inBCafterStudies) {
      to.willBeAway.isInBCafterStudies = "Y";
    }
    else {
      to.willBeAway.isInBCafterStudies = "N";
    }

    if (from.hasDischarge) {
      to.willBeAway.armedDischargeDate = from.dischargeDate.format(this.ISO8601DateFormat);
    }
    /*
     hasPreviousCoverage: ct.YesOrNoType;
     prevPHN?: number;  // BC only
     */
    to.previousCoverage = PreviousCoverageTypeFactory.make();
    to.previousCoverage.hasPreviousCoverage = "N";  // default N
    if (from.hasPreviousBCPhn) {
      to.previousCoverage.hasPreviousCoverage = "Y";

      if (from.previous_phn) {
        to.previousCoverage.prevPHN = Number(from.previous_phn.replace(new RegExp("[^0-9]", "g"), ""));
      }
    }

    return to;
  }

  private convertAddress(from: Address): AddressType {
    // Instantiate new object from interface
    let to = AddressTypeFactory.make();

    /*
     addressLine1: string;
     addressLine2?: string;
     addressLine3?: string;
     city?: string;
     country?: string;
     postalCode?: string;
     provinceOrState?: string;
     */

    to.addressLine1 = from.addressLine1;
    to.addressLine2 = from.addressLine2;
    to.addressLine3 = from.addressLine3;
    to.city = from.city;
    to.country = from.country;
    if (from.postal) {
      to.postalCode = from.postal.toUpperCase().replace(" ", "");
    }
    to.provinceOrState = from.province;

    return to;
  }

  static ApplicationTypeNameSpace = _ApplicationTypeNameSpace;
  private static XmlDocumentType = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  /**
   * Converts any JS object to XML with optional namespace
   * @param from
   * @param namespace
   * @returns {any}
   */
  toXmlString(from: any): string {
    let xml = jxon.jsToXml(from);
    let xmlString = jxon.xmlToString(xml);
    //TODO: namespace not working properly, fix it and remove this hack
    xmlString = xmlString.replace("<application>", '<ns2:application xmlns:ns2="http://www.gov.bc.ca/hibc/applicationTypes">');
    xmlString = xmlString.replace("</application>", '</ns2:application>');
    return MspApiService.XmlDocumentType + xmlString;
  }

  stringToJs<T>(from: string): T {
    let converted = jxon.stringToJs(from) as T;
    return converted;
  }

  jsToXml(from: any) {
    return jxon.jsToXml(from);
  }

  stringToXml(from: string) {
    return jxon.stringToXml(from);
  }

  readonly ISO8601DateFormat = "YYYY-MM-DD";
}